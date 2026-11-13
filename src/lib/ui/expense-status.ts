import { formatBRL } from "@/lib/money";
import { PARTIAL_CHIP, partialLine } from "./partial-pay";

export type YourStatus = "payer" | "pending" | "paid" | "refund" | "none";
export type ShareStatus = "payer" | "pending" | "paid" | "refund";
export type Tone = "owe" | "wait" | "ok";

type ListStatusInput = {
	yourStatus: YourStatus;
	yourShareCents: number;
	yourDueCents?: number;
	yourRefundCents?: number;
	/** Quanto você já pagou da sua parte (pagamento parcial). */
	yourPaidCents?: number;
	pendingCount: number;
	refundCount?: number;
	/** Quantas partes em aberto já têm pagamento parcial. */
	partialCount?: number;
};

function plural(n: number, one: string, many: string): string {
	return n === 1 ? one : many;
}

/**
 * Situação da pessoa numa despesa, para a lista: "Você deve R$ X", "A receber de volta R$ X",
 * "Faltam 2 pagamentos", "Devolver para 1 pessoa", "Tudo pago"; null se não participa.
 */
export function listStatus(e: ListStatusInput): { text: string; tone: Tone } | null {
	switch (e.yourStatus) {
		case "pending": {
			const due = e.yourDueCents && e.yourDueCents > 0 ? e.yourDueCents : e.yourShareCents;
			if ((e.yourPaidCents ?? 0) > 0 && due < e.yourShareCents) return { text: partialLine(e.yourPaidCents ?? 0, due), tone: "owe" };
			return { text: `Você deve ${formatBRL(due)}`, tone: "owe" };
		}
		case "refund":
			return { text: `A receber de volta ${formatBRL(e.yourRefundCents ?? 0)}`, tone: "ok" };
		case "payer": {
			const pending = Math.max(0, e.pendingCount);
			const refunds = Math.max(0, e.refundCount ?? 0);
			const partial = Math.max(0, e.partialCount ?? 0);
			const partialNote = partial > 0 ? ` · ${plural(partial, "1 pago parcialmente", `${partial} pagos parcialmente`)}` : "";
			if (pending > 0 && refunds > 0) {
				return { text: `${plural(pending, "Falta 1 pagamento", `Faltam ${pending} pagamentos`)} e ${plural(refunds, "1 devolução", `${refunds} devoluções`)}`, tone: "wait" };
			}
			if (refunds > 0) return { text: `Devolver para ${plural(refunds, "1 pessoa", `${refunds} pessoas`)}`, tone: "owe" };
			if (pending > 0) return { text: `${plural(pending, "Falta 1 pagamento", `Faltam ${pending} pagamentos`)}${partialNote}`, tone: "wait" };
			return { text: "Tudo pago", tone: "ok" };
		}
		case "paid":
			return { text: "Você já pagou", tone: "ok" };
		default:
			return null;
	}
}

export function paidByLabel(paidBy: { name: string; isYou: boolean; youManage?: boolean }): string {
	if (paidBy.isYou) return "Você pagou";
	return paidBy.youManage ? `Pago por ${paidBy.name} (você cuida)` : `Pago por ${paidBy.name}`;
}

/** Valores da pessoa na despesa, para o selo ser preciso ("Falta pagar R$ X" só quando a dívida é parcial). */
export type ShareAmounts = { amountCents?: number; dueCents?: number; refundCents?: number; paidCents?: number; participates?: boolean };

/** Selo de cada pessoa na despesa. */
export function shareStatusChip(status: ShareStatus, v: ShareAmounts = {}): { text: string; tone: Tone | "neutral" } {
	switch (status) {
		case "payer":
			return { text: "Pagou a conta", tone: "ok" };
		case "refund":
			return { text: `A receber de volta ${formatBRL(v.refundCents ?? 0)}`, tone: "wait" };
		case "paid":
			return v.participates === false ? { text: "Devolvido", tone: "ok" } : { text: "Pago", tone: "ok" };
		default: {
			// Já recebeu algum pagamento mas ainda falta: "Pago parcialmente" (nunca "Pago"); o quanto falta vai na linha de baixo.
			const partial = v.dueCents !== undefined && v.dueCents > 0 && (v.paidCents ?? 0) > 0;
			return { text: partial ? PARTIAL_CHIP : "Falta pagar", tone: "wait" };
		}
	}
}
