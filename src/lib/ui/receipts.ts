/** Textos e decisões puras sobre "Já paguei" e comprovantes (sem React). */

import { batchCaption } from "./pay-all";

/** "pay" = já paguei uma parte; "attach" = anexar comprovante; "batch" = já paguei várias contas de uma vez. */
export type ReceiptMode = "pay" | "attach" | "batch";

export type ReceiptShareLike = {
	status: string;
	method: "manual" | "self" | null;
	participates: boolean;
	receipt: { name: string; contentType: string; size: number } | null;
	canAddReceipt: boolean;
	/** Paga junto com outras contas, num Pix só. */
	batch?: { totalCents: number; count: number } | null;
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
export function paidCaption(s: Pick<ReceiptShareLike, "status" | "method" | "participates" | "batch">, when: string): string | null {
	if (s.status !== "paid") return null;
	const date = when ? ` · ${when}` : "";
	const joint = batchCaption(s.batch);
	let base: string | null = null;
	if (s.method === "self") base = `Avisou que pagou${date}`;
	else if (s.method === "manual") base = `${s.participates ? "Marcado por quem pagou a conta" : "Devolução marcada por quem pagou a conta"}${date}`;
	if (base && joint) return `${base} · ${joint}`;
	return base ?? joint;
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
	return mode === "attach" ? "Comprovante enviado!" : "Pagamento avisado!";
}
