import { ObjectId, type Db } from "mongodb";
import { expensesCollection } from "@/lib/expenses/repo";
import { isObjectIdHex } from "@/lib/groups/helpers";
import { groupsCollection } from "@/lib/groups/repo";
import { CLOSING_STALE_MS, plansCollection, type PlanDoc } from "./collection";

type Closing = NonNullable<PlanDoc["closing"]>;

/**
 * Desfaz UMA tentativa de fechamento (a identificada por `closing.attemptId`), nunca mais que isso:
 * 1. devolve o plano para `open`, filtrando por status e `attemptId` (se outra tentativa já tomou o lugar, não mexe nele);
 * 2. apaga a despesa e o grupo pelos códigos que a própria tentativa sorteou (nunca por `planId` solto).
 * `onlyIfReverted`: na recuperação de uma tentativa que pode estar viva, só limpa o que sobrou se foi esta chamada que
 * reverteu o plano (se a tentativa concluiu antes, o plano ficou `done` e nada é apagado). Devolve se o plano foi revertido.
 */
export async function rollbackAttempt(db: Db, planId: ObjectId, closing: Closing, opts: { onlyIfReverted?: boolean } = {}): Promise<boolean> {
	let reverted = false;
	try {
		const res = await plansCollection(db).updateOne(
			{ _id: planId, status: "closing", "closing.attemptId": closing.attemptId },
			{ $set: { status: "open", updatedAt: new Date() }, $unset: { closing: "" }, $inc: { version: 1 } },
		);
		reverted = res.matchedCount > 0;
	} catch {
		console.error("closePlan rollback error: plan");
	}
	if (opts.onlyIfReverted && !reverted) return false;
	if (closing.expenseId && isObjectIdHex(closing.expenseId)) {
		try {
			await expensesCollection(db).deleteOne({ _id: new ObjectId(closing.expenseId), planId: planId.toHexString() });
		} catch {
			console.error("closePlan rollback error: expense");
		}
	}
	if (isObjectIdHex(closing.groupId)) {
		try {
			await groupsCollection(db).deleteOne({ _id: new ObjectId(closing.groupId) });
		} catch {
			console.error("closePlan rollback error: group");
		}
	}
	return reverted;
}

export const isStaleClosing = (plan: Pick<PlanDoc, "status" | "closing">, now: Date): boolean =>
	plan.status === "closing" && (!plan.closing || now.getTime() - plan.closing.at.getTime() > CLOSING_STALE_MS);

/** Fechamento preso (a função foi interrompida): desfaz de forma preguiçosa, na leitura, e devolve o plano atualizado. */
export async function recoverIfStale(db: Db, plan: PlanDoc, now: Date = new Date()): Promise<PlanDoc> {
	if (!isStaleClosing(plan, now)) return plan;
	if (plan.closing) await rollbackAttempt(db, plan._id, plan.closing, { onlyIfReverted: true });
	else await plansCollection(db).updateOne({ _id: plan._id, status: "closing" }, { $set: { status: "open", updatedAt: now }, $inc: { version: 1 } });
	return (await plansCollection(db).findOne({ _id: plan._id })) ?? plan;
}
