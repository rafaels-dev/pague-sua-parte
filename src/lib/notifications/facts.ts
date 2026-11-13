import { normalizeShares, shareStatus, type ExpenseShare } from "@/lib/expenses/shares";
import type { NewExpenseFact, PaymentFact } from "./types";

type ExpenseLike = { _id: { toHexString(): string }; groupId: { toHexString(): string }; paidBy: string; description: string };

/**
 * Compara as cotas antes e depois de uma gravação e devolve o que mudou de verdade: cota pendente que virou paga e
 * devolução que foi feita (e pagamento parcial, que deixa a parte em aberto). "Desfazer", troca de comprovante e cotas que já estavam pagas não geram nada.
 */
export function paymentFacts(e: ExpenseLike, rawBefore: ExpenseShare[], rawAfter: ExpenseShare[], actorUid: string, manual: boolean): PaymentFact[] {
	const before = normalizeShares(rawBefore);
	const after = normalizeShares(rawAfter);
	const facts: PaymentFact[] = [];
	for (const a of after) {
		if (a.uid === e.paidBy) continue;
		const b = before.find((x) => x.uid === a.uid);
		if (!b) continue;
		const base = {
			groupId: e.groupId.toHexString(),
			expenseId: e._id.toHexString(),
			description: e.description,
			paidBy: e.paidBy,
			debtorUid: a.uid,
			actorUid,
			manual,
		};
		if (shareStatus(b, e.paidBy) === "pending" && b.amountCents > 0 && shareStatus(a, e.paidBy) === "paid") {
			facts.push({ ...base, kind: "payment", amountCents: a.amountCents - b.paidCents });
		} else if (shareStatus(b, e.paidBy) === "pending" && b.amountCents > 0 && shareStatus(a, e.paidBy) === "pending" && a.paidCents > b.paidCents) {
			// Pagamento parcial: a parte continua em aberto; o aviso diz quanto entrou agora e quanto falta.
			facts.push({ ...base, kind: "payment", amountCents: a.paidCents - b.paidCents, partial: { shareCents: a.amountCents, remainingCents: a.amountCents - a.paidCents } });
		} else if (b.paidCents > b.amountCents && !b.refund && a.refund) {
			facts.push({ ...base, kind: "refund", amountCents: a.refund.cents, manual: false });
		}
	}
	return facts;
}

/** Quem passou a dividir a despesa numa edição (cota > 0 agora e não antes). */
export function addedParticipants(before: ExpenseShare[], after: ExpenseShare[]): { uid: string; amountCents: number }[] {
	const was = new Set(before.filter((s) => s.amountCents > 0).map((s) => s.uid));
	return after.filter((s) => s.amountCents > 0 && !was.has(s.uid)).map((s) => ({ uid: s.uid, amountCents: s.amountCents }));
}

/** Quem entrou na divisão numa edição, como "despesa nova" só para essas pessoas; undefined se ninguém entrou. */
export function addedFact(
	e: ExpenseLike & { amountCents: number },
	before: ExpenseShare[],
	after: ExpenseShare[],
	actorUid: string,
): NewExpenseFact | undefined {
	const shares = addedParticipants(normalizeShares(before), normalizeShares(after));
	if (shares.length === 0) return undefined;
	return {
		groupId: e.groupId.toHexString(),
		expenseId: e._id.toHexString(),
		description: e.description,
		amountCents: e.amountCents,
		paidBy: e.paidBy,
		actorUid,
		shares,
	};
}
