/** Textos e decisões puras sobre "Já paguei" e comprovantes (sem React). */

import { batchCaption } from "./pay-all";

/** "pay" = já paguei uma parte; "attach" = anexar comprovante; "batch" = já paguei várias contas de uma vez; "refund" = devolvi o que a pessoa pagou a mais. */
export type ReceiptMode = "pay" | "attach" | "batch" | "refund";

export type ReceiptShareLike = {
	status: string;
	method: "manual" | "self" | null;
	participates: boolean;
	receipt: { name: string; contentType: string; size: number } | null;
	canAddReceipt: boolean;
	/** Paga junto com outras contas, num Pix só. */
	batch?: { totalCents: number; count: number } | null;
	/** Quem marcou como pago, quando foi o administrador do grupo (e não quem pagou a conta). */
	markedByAdmin?: boolean;
	markedByName?: string | null;
};

/** Textos do sheet de comprovante: "Já paguei" (avisa e, se quiser, envia) ou só "Anexar comprovante". */
export function receiptSheetCopy(mode: ReceiptMode, payeeName: string, count = 0): { title: string; intro: string; send: string; skip: string | null } {
	if (mode === "batch") {
		return {
			title: "Já paguei tudo",
			intro: count > 1 ? `Um comprovante só vale para as ${count} contas.` : "Um comprovante só vale para todas as contas.",
			send: "Enviar comprovante",
			skip: "Avisar sem comprovante",
		};
	}
	if (mode === "refund") {
		return {
			title: "Devolvi",
			intro: `Se você enviar o comprovante, ${payeeName} consegue confirmar que recebeu de volta.`,
			send: "Enviar comprovante",
			skip: "Marcar sem comprovante",
		};
	}
	return mode === "pay"
		? {
				title: "Já paguei",
				intro: `Se você enviar o comprovante, ${payeeName} consegue confirmar que recebeu.`,
				send: "Enviar comprovante",
				skip: "Avisar sem comprovante",
			}
		: {
				title: "Anexar comprovante",
				intro: `Envie o comprovante para ${payeeName} confirmar que recebeu.`,
				send: "Enviar comprovante",
				skip: null,
			};
}

/** Linha de apoio embaixo de uma parte paga; null quando não há o que dizer. */
export function paidCaption(s: Pick<ReceiptShareLike, "status" | "method" | "participates" | "batch" | "markedByAdmin" | "markedByName">, when: string): string | null {
	if (s.status !== "paid") return null;
	const date = when ? ` · ${when}` : "";
	const joint = batchCaption(s.batch);
	let base: string | null = null;
	if (s.method === "self") base = `Avisou que pagou${date}`;
	else if (s.method === "manual" && s.markedByAdmin) base = `Marcado pelo administrador${s.markedByName ? ` (${s.markedByName})` : ""}${date}`;
	else if (s.method === "manual") base = `${s.participates ? "Marcado por quem pagou a conta" : "Devolução marcada por quem pagou a conta"}${date}`;
	if (base && joint) return `${base} · ${joint}`;
	return base ?? joint;
}

/** Linha de apoio de uma devolução já feita: "Devolvido R$ 4,00 · hoje · pelo administrador (Ana)". */
export function refundCaption(r: { cents: number; byAdmin: boolean; markedByName: string | null }, when: string, formatMoney: (cents: number) => string): string {
	const by = r.byAdmin ? ` · marcado pelo administrador${r.markedByName ? ` (${r.markedByName})` : ""}` : "";
	return `Devolvido ${formatMoney(r.cents)}${when ? ` · ${when}` : ""}${by}`;
}

/** Texto da ação de desfazer do dono: quando a pessoa avisou que pagou, vira "Não recebi". */
export function undoLabel(s: Pick<ReceiptShareLike, "method">): string {
	return s.method === "self" ? "Não recebi" : "Desfazer";
}

/** Qual ação de comprovante aparece na linha de uma parte (no máximo uma "principal" e uma discreta). */
export function receiptActions(s: ReceiptShareLike): { view: boolean; attach: boolean; replace: boolean } {
	const paid = s.status === "paid";
	return {
		view: paid && !!s.receipt,
		attach: paid && s.canAddReceipt && !s.receipt,
		replace: paid && s.canAddReceipt && !!s.receipt,
	};
}

/** Mensagem do aviso depois de enviar. */
export function receiptDoneMessage(mode: ReceiptMode): string {
	if (mode === "refund") return "Devolução registrada!";
	return mode === "attach" ? "Comprovante enviado!" : "Pagamento avisado!";
}
