import { ObjectId, type Db } from "mongodb";
import { describeError } from "@/lib/api/http";
import { todayInSaoPaulo } from "@/lib/expenses/dates";
import { expensesCollection } from "@/lib/expenses/repo";
import { groupsCollection } from "@/lib/groups/repo";
import { emailConfigured } from "@/lib/notifications/email";
import { notify, reachableUids } from "@/lib/notifications/notify";
import { pushConfigured } from "@/lib/notifications/push";
import { buildReminderNotice } from "@/lib/notifications/reminder-messages";
import { recurrencesCollection } from "@/lib/recurrences/collection";
import { addPeriods } from "@/lib/recurrences/period";
import { expenseKey, planReminders, rotateWithinLead, type ReminderItem } from "./plan";

/** Registro de cada lembrete já enviado: o índice único (despesa fixa, mês, antecedência, pessoa) impede repetir. Some sozinho (TTL). */
export type ReminderLogDoc = { recurrenceId: string; period: string; lead: number; uid: string; createdAt: Date };
export const reminderLog = (db: Db) => db.collection<ReminderLogDoc>("reminder_log");
/** Quanto tempo o registro fica (segundos): bem mais que os 15 dias do primeiro lembrete. */
export const REMINDER_LOG_TTL_SECONDS = 120 * 24 * 60 * 60;

/** No máximo isto por execução (o Mailgun gratuito manda 100 e-mails por dia; sobra margem para os outros avisos). */
export const MAX_REMINDERS_PER_RUN = 60;
/** Lembretes enviados por vez (um lote = um registro em `reminder_log` e uma chamada de `notify`). */
export const REMINDER_BATCH = 10;
/**
 * Prazo ABSOLUTO da execução, contado do início. A rota tem `maxDuration` de 60 s: sobram 15 s de margem para o que acontece
 * fora dos envios (banco, resposta). Nenhum envio ultrapassa este instante, porque cada lote recebe o prazo como limite.
 */
export const RUN_BUDGET_MS = 45_000;
/** Tempo máximo de um lote (envios em paralelo de 2, com espera de nova tentativa incluída). */
export const BATCH_BUDGET_MS = 15_000;
/** Lote só começa se ainda sobram pelo menos isto do prazo (senão, nem registra: os lembretes ficam para o "adiado"). */
export const MIN_BATCH_START_MS = 8_000;

/**
 * Contagens (nunca dados pessoais). `sent`: avisos que chegaram a algum canal. `failed`: registrados mas não entregues em nenhum
 * canal tentado (nunca são reenviados: no máximo uma vez). `skipped`: ficaram de fora pelo teto de quantidade ou de tempo (não
 * foram registrados; se o dia passar, perdem-se). Quem não tem canal ligado (preferências) não entra em `sent` nem em `failed`.
 */
export type ReminderRunResult = { planned: number; sent: number; failed: number; duplicates: number; /** Sem nenhum canal utilizável (e-mail confirmado ou push): não entram na fila nem gastam teto. */ noChannel: number; skipped: number; stoppedEarly: boolean; channels: boolean };

/**
 * Registra os lembretes do lote ANTES de enviar, numa ida só (`insertMany` sem ordem). Devolve os que esta execução registrou de fato;
 * os já registrados (chave duplicada, código 11000) ficam de fora. Qualquer outro erro sobe.
 */
export async function claimReminders(db: Db, items: ReminderItem[], now: Date): Promise<ReminderItem[]> {
	if (items.length === 0) return [];
	try {
		await reminderLog(db).insertMany(
			items.map((i) => ({ recurrenceId: i.recurrenceId, period: i.period, lead: i.lead, uid: i.uid, createdAt: now }) as ReminderLogDoc),
			{ ordered: false },
		);
		return items;
	} catch (err) {
		const raw = (err as { writeErrors?: unknown }).writeErrors;
		const errors = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { index?: number; code?: number; err?: { index?: number; code?: number } }[];
		const codes = errors.map((e) => e.code ?? e.err?.code);
		if (errors.length === 0 || !codes.every((c) => c === 11000)) throw err;
		const dup = new Set(errors.map((e) => e.index ?? e.err?.index));
		return items.filter((_i, idx) => !dup.has(idx));
	}
}

/**
 * Cron diário: envia os lembretes de vencimento de hoje (São Paulo). Nunca cria despesa. Sem canal de aviso configurado, não faz nada.
 * Termina sempre antes de `RUN_BUDGET_MS`. Cada lote é registrado antes do envio (no máximo uma vez); se o cron não rodar num dia,
 * os lembretes daquele dia se perdem.
 */
export async function runReminders(db: Db, now: Date = new Date(), opts: { budgetMs?: number; max?: number } = {}): Promise<ReminderRunResult> {
	const result: ReminderRunResult = { planned: 0, sent: 0, failed: 0, duplicates: 0, noChannel: 0, skipped: 0, stoppedEarly: false, channels: true };
	if (!emailConfigured() && !pushConfigured()) return { ...result, channels: false };
	const started = Date.now();
	const runDeadline = started + (opts.budgetMs ?? RUN_BUDGET_MS);
	const today = todayInSaoPaulo(now);
	const cutoff = new Date(now.getTime() - 70 * 24 * 60 * 60 * 1000);
	const recurrences = await recurrencesCollection(db)
		.find({ $or: [{ active: true }, { active: false, endPeriod: { $exists: true }, endedAt: { $gte: cutoff } }] })
		.toArray();
	if (recurrences.length === 0) return result;
	const groupIds = [...new Set(recurrences.map((r) => r.groupId.toHexString()))].map((h) => new ObjectId(h));
	const groups = new Map((await groupsCollection(db).find({ _id: { $in: groupIds } }).toArray()).map((g) => [g._id.toHexString(), g]));
	const cur = today.slice(0, 7);
	const periods = [addPeriods(cur, -1), cur, addPeriods(cur, 1)];
	// `$type: "string"` casa com o filtro parcial do índice `recurrence_period_unique`; sem ele o MongoDB varre a coleção inteira (conferido com explain).
	const existing = await expensesCollection(db)
		.find({ "recurrence.id": { $in: recurrences.map((r) => r._id.toHexString()), $type: "string" }, "recurrence.period": { $in: periods } }, { projection: { paidBy: 1, description: 1, shares: 1, dueDate: 1, recurrence: 1 } })
		.toArray();
	const expenses = new Map(existing.flatMap((e) => (e.recurrence ? [[expenseKey(e.recurrence.id, e.recurrence.period), e] as const] : [])));

	const all = planReminders({ today, recurrences, groups, expenses });
	// Quem nunca receberia nada (sem e-mail utilizável nem push) não gasta teto nem registro.
	const reachable = await reachableUids(db, [...new Set(all.map((i) => i.uid))]);
	const items = rotateWithinLead(all.filter((i) => reachable.has(i.uid)), today);
	result.noChannel = all.length - items.length;
	result.planned = items.length;
	const queue = items.slice(0, opts.max ?? MAX_REMINDERS_PER_RUN);
	result.skipped = items.length - queue.length;
	for (let at = 0; at < queue.length; at += REMINDER_BATCH) {
		if (runDeadline - Date.now() < MIN_BATCH_START_MS) {
			result.stoppedEarly = true;
			result.skipped += queue.length - at;
			break;
		}
		const batch = queue.slice(at, at + REMINDER_BATCH);
		let fresh: ReminderItem[];
		try {
			fresh = await claimReminders(db, batch, now);
		} catch (err) {
			console.error("lembretes: falha ao registrar o lote:", describeError(err));
			result.failed += batch.length;
			result.stoppedEarly = true;
			result.skipped += queue.length - at - batch.length;
			break;
		}
		result.duplicates += batch.length - fresh.length;
		const report = await notify(db, fresh.map(buildReminderNotice), { deadline: Math.min(runDeadline, Date.now() + BATCH_BUDGET_MS) });
		result.sent += report.delivered;
		result.failed += report.failed;
	}
	// Só números, em texto fixo: nada de nomes, endereços nem ids.
	if (result.failed > 0 || result.skipped > 0) console.error(`lembretes de vencimento: ${result.failed} falharam em todos os canais, ${result.skipped} ficaram de fora pelo teto`);
	return result;
}
