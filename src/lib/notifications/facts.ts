import { createHash } from "node:crypto";
import { latestPayment, normalizeShares, paymentEntries, shareStatus, type ExpenseShare } from "@/lib/expenses/shares";
import type { NewExpenseFact, PaymentFact, ReceiptSpec } from "./types";

/** Resumo (SHA-256, hex) da chave do arquivo: identifica o comprovante sem expor a chave. */
export const receiptDigest = (key: string): string => createHash("sha256").update(key).digest("hex");

/** Só uma referência (qual pagamento da parte e o resumo do arquivo), nunca a chave: o comprovante do pagamento mais recente da parte. */
export function latestReceiptSpec(s: ExpenseShare): ReceiptSpec | undefined {
	const last = latestPayment(s);
	if (!last?.receipt) return undefined;
	const digest = receiptDigest(last.receipt.key);
	return last.kind === "part" && s.parts?.[last.index] ? { kind: "payment", partId: s.parts[last.index].id, digest } : { kind: "payment", digest };
}

/**
 * O comprovante do pagamento que ACABOU de ser registrado nesta gravação: só existe se entrou dinheiro novo (`paidCents` subiu) e o
 * último pagamento da parte tem comprovante diferente do que já havia. Parte que só passou a "quitada" porque foi recalculada
 * (valor menor, divisão mudada) não teve pagamento novo: nunca aponta o comprovante de um pagamento antigo.
 */
export function newPaymentReceipt(before: ExpenseShare, after: ExpenseShare): ReceiptSpec | undefined {
	if (after.paidCents <= before.paidCents) return undefined;
	const spec = latestReceiptSpec(after);
	if (!spec) return undefined;
	const oldKey = latestPayment(before)?.receipt?.key;
	return oldKey !== undefined && receiptDigest(oldKey) === spec.digest ? undefined : spec;
}

/** Idem, para o pagamento do lote `batchId` (adiantamento): o pagamento da parte que tem esse lote e comprovante. */
export function batchReceiptSpec(s: ExpenseShare, batchId: string): ReceiptSpec | undefined {
	const e = paymentEntries(s).find((x) => x.batch?.id === batchId && x.receipt);
	if (!e?.receipt) return undefined;
	const digest = receiptDigest(e.receipt.key);
	return e.kind === "part" && s.parts?.[e.index] ? { kind: "payment", partId: s.parts[e.index].id, digest } : { kind: "payment", digest };
}

type ExpenseLike = { _id: { toHexString(): string }; groupId: { toHexString(): string }; paidBy: string; description: string };

const receiptField = (r: ReceiptSpec | undefined) => (r ? { receipt: r } : {});

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
			facts.push({ ...base, kind: "payment", amountCents: a.amountCents - b.paidCents, ...receiptField(newPaymentReceipt(b, a)) });
		} else if (shareStatus(b, e.paidBy) === "pending" && b.amountCents > 0 && shareStatus(a, e.paidBy) === "pending" && a.paidCents > b.paidCents) {
			// Pagamento parcial: a parte continua em aberto; o aviso diz quanto entrou agora e quanto falta.
			facts.push({ ...base, kind: "payment", amountCents: a.paidCents - b.paidCents, partial: { shareCents: a.amountCents, remainingCents: a.amountCents - a.paidCents }, ...receiptField(newPaymentReceipt(b, a)) });
		} else if (b.paidCents > b.amountCents && !b.refund && a.refund) {
			facts.push({ ...base, kind: "refund", amountCents: a.refund.cents, manual: false, ...(a.refund.receipt ? { receipt: { kind: "refund" as const, digest: receiptDigest(a.refund.receipt.key) } } : {}) });
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
