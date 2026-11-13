import { describe, expect, it } from "vitest";
import { paidNoticeAmount, amountHint, checkAmount, isPartial, partialLine, partLine, PARTIAL_CHIP, undoPartCentsOf } from "./partial-pay";
import { buildPaidShareText } from "./expense-share";
import { receiptSheetCopy } from "./receipts";
import { managedLines } from "./managed";
import { seriesItemChipText, seriesItemState } from "./due-dates";
import { normalizeExpense, normalizeSummary } from "@/components/expenses/types";

describe("textos do pagamento parcial", () => {
	it("selo e linha curta", () => {
		expect(PARTIAL_CHIP).toBe("Pago parcialmente");
		expect(partialLine(4700, 5300)).toBe("Faltam R$ 53,00 · já pagou R$ 47,00");
	});
	it("isPartial: só pendente com algo pago e algo faltando", () => {
		expect(isPartial({ status: "pending", paidCents: 4700, dueCents: 5300 })).toBe(true);
		expect(isPartial({ status: "pending", paidCents: 0, dueCents: 5300 })).toBe(false);
		expect(isPartial({ status: "paid", paidCents: 10000, dueCents: 0 })).toBe(false);
	});
	it("linha do histórico: como e quando foi pago", () => {
		expect(partLine({ cents: 4700, method: "self", byAdmin: false, markedByName: null }, "hoje")).toBe("R$ 47,00 · hoje · avisou que pagou");
		expect(partLine({ cents: 34700, method: "manual", byAdmin: false, markedByName: null }, "12 nov")).toBe("R$ 347,00 · 12 nov · recebido por quem pagou a conta");
		expect(partLine({ cents: 100, method: "manual", byAdmin: true, markedByName: "Ana" }, "")).toBe("R$ 1,00 · recebido, marcado pelo administrador (Ana)");
	});
	it("desfazer o último parcial só quando a parte está em aberto com parciais", () => {
		// o valor anunciado vem de `last` (o mesmo pagamento que o servidor desfaz), não de "o último da lista"
		expect(undoPartCentsOf({ status: "pending", last: { cents: 8000, partial: false } })).toBe(8000);
		expect(undoPartCentsOf({ status: "pending", last: { cents: 250, partial: true } })).toBe(250);
		expect(undoPartCentsOf({ status: "paid", last: { cents: 250, partial: true } })).toBe(250);
		expect(undoPartCentsOf({ status: "paid", last: { cents: 10000, partial: false } })).toBeUndefined(); // tira a quitação inteira: texto de sempre
		expect(undoPartCentsOf({ status: "pending", last: null })).toBeUndefined();
	});
});

describe("checkAmount (Pagar outro valor / Recebi só uma parte)", () => {
	it("vazio, maior, parcial e igual", () => {
		expect(checkAmount(0, 10000)).toEqual({ kind: "empty" });
		expect(checkAmount(-5, 10000)).toEqual({ kind: "empty" });
		expect(checkAmount(1.5, 10000)).toEqual({ kind: "empty" });
		expect(checkAmount(10001, 10000)).toEqual({ kind: "too_much", message: "Esse valor é maior do que falta pagar (R$ 100,00)." });
		expect(checkAmount(4700, 10000)).toEqual({ kind: "part", remainingCents: 5300 });
		expect(checkAmount(10000, 10000)).toEqual({ kind: "full" });
	});
	it("dica embaixo do campo", () => {
		expect(amountHint(checkAmount(4700, 10000))).toBe("Vai faltar R$ 53,00");
		expect(amountHint(checkAmount(10000, 10000))).toBe("Esse valor paga tudo o que falta.");
		expect(amountHint(checkAmount(0, 10000))).toBeNull();
		expect(amountHint(checkAmount(20000, 10000))).toBeNull();
	});
});

describe("textos de WhatsApp e folhas", () => {
	const link = "https://x/y";
	it("\"paguei\" parcial diz o valor pago e o que falta, nunca chave Pix", () => {
		const t = buildPaidShareText({ amountCents: 4700, description: "Mercado.", hasReceipt: true, remainingCents: 5300 }, link);
		expect(t).toBe("Paguei R$ 47,00 da minha parte (faltam R$ 53,00), da despesa Mercado. Veja o comprovante: https://x/y");
		expect(buildPaidShareText({ amountCents: 4700, description: "Mercado", forName: "Vó", hasReceipt: false, remainingCents: 5300 }, link)).toBe("Paguei R$ 47,00 da parte de Vó (faltam R$ 53,00), da despesa Mercado. Confira aqui: https://x/y");
		expect(buildPaidShareText({ amountCents: 10000, description: "Mercado", hasReceipt: false }, link)).toBe("Paguei minha parte, R$ 100,00, da despesa Mercado. Confira aqui: https://x/y");
	});
	it("folha do comprovante com o valor no título", () => {
		expect(receiptSheetCopy("pay", "Ana", 0, 4700).title).toBe("Já paguei R$ 47,00");
		expect(receiptSheetCopy("pay", "Ana").title).toBe("Já paguei");
	});
	it("linhas de quem você cuida mostram o parcial", () => {
		const lines = managedLines([{ uid: "m", name: "Vó", status: "pending", dueCents: 5300, refundCents: 0, paidCents: 4700 }, { uid: "n", name: "Tio", status: "pending", dueCents: 1000, refundCents: 0 }]);
		expect(lines.map((l) => l.text)).toEqual(["Vó: Faltam R$ 53,00 · já pagou R$ 47,00", "Tio deve R$ 10,00"]);
	});
});

describe("série de parcelas", () => {
	const today = "2026-11-11";
	it("parcela com pagamento parcial nunca é paga; vencida vence o parcial, mas o texto diz as duas coisas", () => {
		expect(seriesItemState({ dueDate: "2026-12-10", settled: false, partial: true }, today)).toBe("partial");
		expect(seriesItemState({ dueDate: "2026-12-10", settled: false }, today)).toBe("open");
		expect(seriesItemState({ dueDate: "2026-10-10", settled: false, partial: true }, today)).toBe("overdue");
		expect(seriesItemState({ dueDate: "2026-10-10", settled: true, partial: true }, today)).toBe("paid");
		expect(seriesItemChipText({ partial: true }, "partial")).toBe("Pago em parte");
		expect(seriesItemChipText({ partial: true }, "overdue")).toBe("Vencida · pago em parte");
		expect(seriesItemChipText({}, "overdue")).toBe("Vencida");
	});
});

describe("normalização do que vem da API", () => {
	it("parts e canUndoOwnPart: aceita ausência (servidor antigo) e descarta lixo", () => {
		const d = normalizeExpense({
			shares: [
				{ uid: "a", amountCents: 100, status: "pending", parts: [{ id: "p1", cents: 40, at: "2026-11-11T10:00:00.000Z", method: "self", byAdmin: false, markedByName: null, receipt: { name: "r.png", contentType: "image/png", size: 3 } }, { id: "", cents: 5 }, { id: "x", cents: -1 }, null] },
				{ uid: "b", amountCents: 100, status: "paid" },
			],
		} as never);
		expect(d.shares[0].parts).toEqual([{ id: "p1", cents: 40, at: "2026-11-11T10:00:00.000Z", method: "self", byAdmin: false, markedByName: null, receipt: { name: "r.png", contentType: "image/png", size: 3 }, batch: null }]);
		expect(d.shares[0].canUndoOwnPart).toBe(false);
		expect(d.shares[1].parts).toEqual([]);
	});
	it("série: partial só quando verdadeiro; lista: campos novos com padrão 0", () => {
		const d = normalizeExpense({ shares: [], series: { count: 2, items: [{ id: "1", number: 1, settled: false, partial: true }, { id: "2", number: 2, settled: false }] } } as never);
		expect(d.series!.items.map((i) => i.partial)).toEqual([true, undefined]);
		const s = normalizeSummary({ id: "x", yourStatus: "pending" } as never);
		expect([s.yourPaidCents, s.partialCount]).toEqual([0, 0]);
	});
});

describe("aviso de quem quitou o que faltava depois de parciais", () => {
	const link = "https://x/y";
	it("o valor vem do último pagamento (resposta do servidor), não da parte inteira", () => {
		const mine = { amountCents: 10000, parts: [{}], last: { cents: 5300, partial: false } };
		expect(paidNoticeAmount(mine)).toEqual({ amountCents: 5300, afterParts: true });
		// sem parciais: a parte inteira, texto de sempre; último parcial (parte ainda em aberto) não conta como quitação
		expect(paidNoticeAmount({ amountCents: 10000, parts: [], last: { cents: 10000, partial: false } })).toEqual({ amountCents: 10000, afterParts: false });
		expect(paidNoticeAmount({ amountCents: 10000, parts: [{}], last: { cents: 4700, partial: true } })).toEqual({ amountCents: 10000, afterParts: false });
	});
	it("texto verdadeiro: \"Paguei o que faltava da minha parte, R$ 53,00\"", () => {
		const n = paidNoticeAmount({ amountCents: 10000, parts: [{}], last: { cents: 5300, partial: false } });
		expect(buildPaidShareText({ ...n, description: "Mercado.", hasReceipt: true }, link)).toBe("Paguei o que faltava da minha parte, R$ 53,00, da despesa Mercado. Veja o comprovante: https://x/y");
		expect(buildPaidShareText({ ...n, description: "Mercado", forName: "Vó", hasReceipt: false }, link)).toBe("Paguei o que faltava da parte de Vó, R$ 53,00, da despesa Mercado. Confira aqui: https://x/y");
	});
});
