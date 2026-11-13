import { addDays } from "@/lib/expenses/dates";
import type { ExpenseDoc } from "@/lib/expenses/repo";
import { dueCents, normalizeShares } from "@/lib/expenses/shares";
import type { GroupDoc } from "@/lib/groups/repo";
import { loginOf } from "@/lib/notifications/messages";
import type { RecurrenceDoc } from "@/lib/recurrences/collection";
import { buildRecurringExpense } from "@/lib/recurrences/materialize";
import { addPeriods, dueDateFor } from "@/lib/recurrences/period";

/** Quantos dias antes do vencimento o lembrete sai (0 = no dia). */
export const REMINDER_LEADS = [15, 7, 3, 0] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

/** Hoje (YYYY-MM-DD, São Paulo) está a 15, 7, 3 ou 0 dias do vencimento? Antes ou depois disso, nada. */
export function leadFor(today: string, dueDate: string): ReminderLead | null {
	for (const lead of REMINDER_LEADS) if (addDays(today, lead) === dueDate) return lead;
	return null;
}

export type ReminderItem = {
	recurrenceId: string;
	groupId: string;
	groupName: string;
	period: string;
	lead: ReminderLead;
	/** Quem recebe (pessoa com login): a própria pessoa, ou quem cuida dela. */
	uid: string;
	description: string;
	dueDate: string;
	/** Valor a pagar em centavos: o que falta (despesa já criada) ou a parte prevista (mês que ainda não existe). */
	amountCents: number;
	/** A despesa do mês já existe: `amountCents` é o que FALTA pagar; senão é a parte PREVISTA. */
	exists: boolean;
	expenseId?: string;
	/** O valor inclui a parte da própria pessoa / de quem ela cuida. */
	own: boolean;
	others: boolean;
};

type ExpenseLike = Pick<ExpenseDoc, "_id" | "paidBy" | "description" | "shares" | "dueDate">;

/** Chave da despesa de um mês de uma despesa fixa, para o mapa de despesas existentes. */
export const expenseKey = (recurrenceId: string, period: string) => `${recurrenceId}|${period}`;

/** Encerrada pelo calendário (último mês já gerado): as despesas já criadas ainda merecem lembrete. Encerrada à mão: não. */
const finishedByDate = (r: Pick<RecurrenceDoc, "endPeriod" | "nextPeriod">) => Boolean(r.endPeriod && r.nextPeriod > r.endPeriod);

/**
 * Função PURA: quais lembretes saem hoje. Nada é criado nem lido do banco aqui.
 * - Para cada despesa fixa e cada mês próximo (anterior, atual, seguinte), o vencimento é o da despesa do mês, se ela já existe
 *   (pode ter sido editado), ou o previsto (`dueDateFor`). Hoje precisa estar a 15, 7, 3 ou 0 dias dele.
 * - Despesa do mês já criada: lembra quem ainda deve (o que falta, parcial conta) ou quem cuida da pessoa; quitada: ninguém.
 * - Mês que ainda não existe: parte prevista, pela MESMA divisão da criação do mês (`buildRecurringExpense`). Mês já gerado e depois
 *   apagado (`period < nextPeriod` sem despesa) não é lembrado.
 * - Nunca lembra quem pagou a conta (nem quem cuida dele); pessoa que saiu do grupo e despesa fixa pausada/encerrada à mão: ninguém.
 */
export function planReminders(args: {
	today: string;
	recurrences: RecurrenceDoc[];
	groups: Map<string, Pick<GroupDoc, "_id" | "name" | "members"> & GroupDoc>;
	expenses: Map<string, ExpenseLike>;
}): ReminderItem[] {
	const { today, recurrences, groups, expenses } = args;
	const cur = today.slice(0, 7);
	const periods = [addPeriods(cur, -1), cur, addPeriods(cur, 1)];
	const out: ReminderItem[] = [];
	for (const r of recurrences) {
		const group = groups.get(r.groupId.toHexString());
		if (!group) continue;
		const rid = r._id.toHexString();
		for (const period of periods) {
			const existing = expenses.get(expenseKey(rid, period));
			if (!r.active && !(finishedByDate(r) && existing && period <= (r.endPeriod as string))) continue;
			// O vencimento sai primeiro (barato): só se hoje é dia de lembrete é que vale montar a despesa prevista.
			const dueDate = existing?.dueDate ?? dueDateFor(period, r.dayOfMonth);
			const lead = leadFor(today, dueDate);
			if (lead === null) continue;
			let doc: ExpenseLike;
			if (existing) doc = existing;
			else {
				if (!r.active || period < r.nextPeriod || period < r.startPeriod || (r.endPeriod && period > r.endPeriod)) continue;
				if (!group.members.some((m) => m.uid === r.paidBy)) continue;
				doc = buildRecurringExpense(r, group, period, null, new Date(0));
			}
			const payerLogin = loginOf(group.members, doc.paidBy);
			const byRecipient = new Map<string, { cents: number; own: boolean; others: boolean }>();
			for (const s of normalizeShares(doc.shares)) {
				if (s.uid === doc.paidBy) continue;
				const cents = existing ? dueCents(s, doc.paidBy) : s.amountCents;
				if (cents <= 0) continue;
				const login = loginOf(group.members, s.uid);
				if (!login || login === payerLogin) continue;
				const e = byRecipient.get(login) ?? { cents: 0, own: false, others: false };
				e.cents += cents;
				if (login === s.uid) e.own = true;
				else e.others = true;
				byRecipient.set(login, e);
			}
			for (const [uid, e] of byRecipient) {
				out.push({ recurrenceId: rid, groupId: group._id.toHexString(), groupName: group.name, period, lead, uid, description: doc.description, dueDate, amountCents: e.cents, exists: Boolean(existing), ...(existing ? { expenseId: existing._id.toHexString() } : {}), own: e.own, others: e.others });
			}
		}
	}
	// Ordem estável e útil quando há teto: o mais urgente primeiro (0, 3, 7, 15), depois por ids.
	return out.sort((a, b) => a.lead - b.lead || a.groupId.localeCompare(b.groupId) || a.recurrenceId.localeCompare(b.recurrenceId) || a.period.localeCompare(b.period) || a.uid.localeCompare(b.uid));
}

/** Dias desde 1970-01-01 de uma data YYYY-MM-DD (número inteiro, estável). */
const epochDay = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * Ordem justa quando há teto: a urgência manda (0, 3, 7, 15, como em `planReminders`), mas DENTRO do mesmo nível a lista gira de um dia
 * para o outro (rotação pela data de hoje), para que os mesmos grupos não fiquem sempre no fim da fila. Determinística: mesma data, mesma ordem.
 */
export function rotateWithinLead(items: ReminderItem[], today: string): ReminderItem[] {
	const out: ReminderItem[] = [];
	const day = epochDay(today);
	for (let i = 0; i < items.length; ) {
		let j = i;
		while (j < items.length && items[j].lead === items[i].lead) j++;
		const level = items.slice(i, j);
		const k = day % level.length;
		out.push(...level.slice(k), ...level.slice(0, k));
		i = j;
	}
	return out;
}
