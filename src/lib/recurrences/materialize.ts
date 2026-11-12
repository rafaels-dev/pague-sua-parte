import { ObjectId, type Db } from "mongodb";
import { describeError } from "@/lib/api/http";
import type { ExpenseDoc } from "@/lib/expenses/repo";
import { payerPix, type PayerPix } from "@/lib/expenses/payer-pix";
import { splitEqually } from "@/lib/expenses/split";
import { groupsCollection, type GroupDoc } from "@/lib/groups/repo";
import { recurrencesCollection, type RecurrenceDoc } from "./collection";
import { addPeriods, currentPeriod, dueDateFor, periodsToGenerate, resolveParticipants } from "./period";


/** Despesa comum de um mês da recorrência (mesmo formato que `createExpense` produz, sem anexos). */
export function buildRecurringExpense(r: RecurrenceDoc, group: GroupDoc, period: string, pix: PayerPix | null, now: Date): ExpenseDoc {
	const memberUids = group.members.map((m) => m.uid);
	let participants = resolveParticipants(r.participantMode, r.participantUids, memberUids, r.paidBy);
	let split: { uid: string; amountCents: number }[];
	try {
		split = splitEqually(r.amountCents, participants, r.paidBy);
	} catch {
		// Valor pequeno demais para tanta gente: cobra só de quem paga em vez de travar o mês.
		participants = [r.paidBy];
		split = splitEqually(r.amountCents, participants, r.paidBy);
	}
	return {
		_id: new ObjectId(),
		groupId: r.groupId,
		createdBy: r.createdBy,
		paidBy: r.paidBy,
		description: r.description,
		amountCents: r.amountCents,
		date: `${period}-01`,
		...(pix ? { pix: { ...pix } } : {}),
		shares: split.map((s) => ({ uid: s.uid, amountCents: s.amountCents, paidCents: 0 })),
		version: 0,
		attachments: [],
		dueDate: dueDateFor(period, r.dayOfMonth),
		recurrence: { id: r._id.toHexString(), period },
		createdAt: now,
		updatedAt: now,
	};
}

const isDuplicateKey = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

async function endRecurrence(db: Db, r: RecurrenceDoc, now: Date) {
	await recurrencesCollection(db).updateOne({ _id: r._id, active: true }, { $set: { active: false, endedAt: now, updatedAt: now } });
}

/**
 * Cria as despesas dos meses que já chegaram. Só olha recorrências ativas com `nextPeriod` até o mês atual (uma consulta
 * indexada quando não há nada a fazer). Cada mês é "reservado" avançando `nextPeriod` de forma condicional ANTES de
 * inserir: só quem reservou insere (leituras simultâneas não duplicam) e apagar a despesa de um mês não a traz de volta.
 * O índice único em `recurrence.id + recurrence.period` é a segunda trava. Devolve quantas despesas criou.
 */
export async function materializeRecurrences(db: Db, groupIds: ObjectId[], now: Date = new Date()): Promise<number> {
	if (groupIds.length === 0) return 0;
	const current = currentPeriod(now);
	const recs = recurrencesCollection(db);
	const due = await recs.find({ groupId: { $in: groupIds }, active: true, nextPeriod: { $lte: current } }).toArray();
	if (due.length === 0) return 0;

	const groups = new Map(
		(await groupsCollection(db).find({ _id: { $in: [...new Set(due.map((r) => r.groupId.toHexString()))].map((h) => new ObjectId(h)) } }).toArray()).map((g) => [
			g._id.toHexString(),
			g,
		]),
	);
	let created = 0;
	for (const r of due) {
		const group = groups.get(r.groupId.toHexString());
		if (!group || !group.members.some((m) => m.uid === r.paidBy)) {
			await endRecurrence(db, r, now);
			continue;
		}
		const periods = periodsToGenerate(r.nextPeriod, current, r.endPeriod);
		if (periods.length === 0) {
			// Já passou do último mês: encerra.
			if (r.endPeriod && r.nextPeriod > r.endPeriod) await endRecurrence(db, r, now);
			continue;
		}
		// Sem chave Pix agora, o mês nasce sem cópia da chave (vale a atual de quem paga, na leitura), como numa despesa lançada pelo administrador.
		const pix = await payerPix(db, group, r.paidBy);

		for (const period of periods) {
			const next = addPeriods(period, 1);
			const finished = Boolean(r.endPeriod && next > r.endPeriod);
			const claim = await recs.updateOne(
				{ _id: r._id, active: true, nextPeriod: period },
				{ $set: { nextPeriod: next, updatedAt: now, ...(finished ? { active: false, endedAt: now } : {}) } },
			);
			if (claim.matchedCount === 0) break; // outra leitura está cuidando deste mês
			try {
				await db.collection<ExpenseDoc>("expenses").insertOne(buildRecurringExpense(r, group, period, pix, now));
				created++;
			} catch (err) {
				if (isDuplicateKey(err)) continue; // o mês já existe: nada a fazer
				// Devolve a reserva para tentar de novo depois.
				await recs.updateOne({ _id: r._id, nextPeriod: next }, { $set: { nextPeriod: period, active: true, updatedAt: now }, $unset: { endedAt: "" } }).catch(() => undefined);
				throw err;
			}
		}
	}
	return created;
}

/** Como `materializeRecurrences`, mas uma falha só vai para o log e nunca derruba a leitura. */
export async function materializeSafely(db: Db, groupIds: ObjectId[], now: Date = new Date()): Promise<void> {
	try {
		await materializeRecurrences(db, groupIds, now);
	} catch (err) {
		console.error("materializeRecurrences error:", describeError(err));
	}
}

