/** Textos e decisões puras sobre "Já paguei" e comprovantes (sem React). */

export type ReceiptMode = "pay" | "attach";

export type ReceiptShareLike = {
	status: string;
	method: "manual" | "self" | null;
	participates: boolean;
	receipt: { name: string; contentType: string; size: number } | null;
	canAddReceipt: boolean;
};

/** Textos do sheet de comprovante: "Já paguei" (avisa e, se quiser, envia) ou só "Anexar comprovante". */
export function receiptSheetCopy(mode: ReceiptMode, payeeName: string): { title: string; intro: string; send: string; skip: string | null } {
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
export function paidCaption(s: Pick<ReceiptShareLike, "status" | "method" | "participates">, when: string): string | null {
	if (s.status !== "paid") return null;
	const date = when ? ` · ${when}` : "";
	if (s.method === "self") return `Avisou que pagou${date}`;
	if (s.method === "manual") return `${s.participates ? "Marcado por quem pagou a conta" : "Devolução marcada por quem pagou a conta"}${date}`;
	return null;
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
	return mode === "pay" ? "Pagamento avisado!" : "Comprovante enviado!";
}
