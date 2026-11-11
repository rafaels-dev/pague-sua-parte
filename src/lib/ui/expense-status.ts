import { formatBRL } from "@/lib/money";

export type YourStatus = "payer" | "pending" | "paid" | "none";
export type ShareStatus = "payer" | "pending" | "paid";
export type Tone = "owe" | "wait" | "ok";

/** Situação da pessoa numa despesa, para a lista: "Você deve R$ X", "Faltam 2 pagamentos", "Tudo pago"; null se não participa. */
export function listStatus(e: { yourStatus: YourStatus; yourShareCents: number; pendingCount: number }): { text: string; tone: Tone } | null {
	switch (e.yourStatus) {
		case "pending":
			return { text: `Você deve ${formatBRL(e.yourShareCents)}`, tone: "owe" };
		case "payer":
			if (e.pendingCount <= 0) return { text: "Tudo pago", tone: "ok" };
			return { text: e.pendingCount === 1 ? "Falta 1 pagamento" : `Faltam ${e.pendingCount} pagamentos`, tone: "wait" };
		case "paid":
			return { text: "Você já pagou", tone: "ok" };
		default:
			return null;
	}
}

export function paidByLabel(paidBy: { name: string; isYou: boolean }): string {
	return paidBy.isYou ? "Você pagou" : `Pago por ${paidBy.name}`;
}

/** Selo de cada pessoa na despesa. */
export function shareStatusChip(status: ShareStatus): { text: string; tone: Tone } {
	switch (status) {
		case "payer":
			return { text: "Pagou a conta", tone: "ok" };
		case "paid":
			return { text: "Pago", tone: "ok" };
		default:
			return { text: "Falta pagar", tone: "wait" };
	}
}
