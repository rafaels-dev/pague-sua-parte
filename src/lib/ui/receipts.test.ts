import { describe, expect, it } from "vitest";
import { paidCaption, receiptActions, receiptDoneMessage, receiptSheetCopy, undoLabel } from "./receipts";

const receipt = { name: "comprovante.jpg", contentType: "image/jpeg", size: 1000 };
const base = { status: "paid", method: "self" as const, participates: true, receipt: null, canAddReceipt: false };

describe("receiptSheetCopy", () => {
	it("já paguei: explica e oferece avisar sem comprovante", () => {
		const c = receiptSheetCopy("pay", "Maria");
		expect(c.title).toBe("Já paguei");
		expect(c.intro).toContain("Maria");
		expect(c.skip).toBe("Avisar sem comprovante");
	});
	it("anexar: botão único", () => {
		const c = receiptSheetCopy("attach", "Maria");
		expect(c.title).toBe("Anexar comprovante");
		expect(c.send).toBe("Enviar comprovante");
		expect(c.skip).toBeNull();
	});
});

describe("receiptSheetCopy (várias contas)", () => {
	it("já paguei tudo: um comprovante vale para todas", () => {
		const c = receiptSheetCopy("batch", "Maria", 3);
		expect(c.title).toBe("Já paguei tudo");
		expect(c.intro).toBe("Um comprovante só vale para as 3 contas.");
		expect(c.send).toBe("Enviar comprovante");
		expect(c.skip).toBe("Avisar sem comprovante");
		expect(receiptDoneMessage("batch")).toBe("Pagamento avisado!");
	});
});

describe("paidCaption", () => {
	it("pago junto com outras contas", () => {
		const batch = { count: 3, totalCents: 35000 };
		expect(paidCaption({ ...base, batch }, "Hoje")).toBe("Avisou que pagou · Hoje · Pago junto com outras 2 contas (R$ 350,00 no total)");
		expect(paidCaption({ ...base, method: null, batch }, "")).toBe("Pago junto com outras 2 contas (R$ 350,00 no total)");
		expect(paidCaption({ ...base, status: "pending", batch }, "")).toBeNull();
		expect(paidCaption({ ...base, batch: null }, "")).toBe("Avisou que pagou");
	});
	it("avisou que pagou", () => {
		expect(paidCaption(base, "Hoje")).toBe("Avisou que pagou · Hoje");
		expect(paidCaption(base, "")).toBe("Avisou que pagou");
	});
	it("mantém o texto de quem marcou", () => {
		expect(paidCaption({ ...base, method: "manual" }, "Ontem")).toBe("Marcado por quem pagou a conta · Ontem");
		expect(paidCaption({ ...base, method: "manual", participates: false }, "")).toBe("Devolução marcada por quem pagou a conta");
	});
	it("nada quando não está pago ou sem método", () => {
		expect(paidCaption({ ...base, status: "pending" }, "Hoje")).toBeNull();
		expect(paidCaption({ ...base, method: null }, "Hoje")).toBeNull();
	});
});

describe("undoLabel", () => {
	it("Não recebi só quando a pessoa avisou", () => {
		expect(undoLabel({ method: "self" })).toBe("Não recebi");
		expect(undoLabel({ method: "manual" })).toBe("Desfazer");
		expect(undoLabel({ method: null })).toBe("Desfazer");
	});
});

describe("receiptActions", () => {
	it("ver quando há comprovante", () => expect(receiptActions({ ...base, receipt })).toEqual({ view: true, attach: false, replace: false }));
	it("anexar quando pode e não tem", () => expect(receiptActions({ ...base, canAddReceipt: true })).toEqual({ view: false, attach: true, replace: false }));
	it("trocar quando pode e já tem", () => expect(receiptActions({ ...base, canAddReceipt: true, receipt })).toEqual({ view: true, attach: false, replace: true }));
	it("nada se não está pago", () => expect(receiptActions({ ...base, status: "pending", canAddReceipt: true, receipt })).toEqual({ view: false, attach: false, replace: false }));
});

describe("receiptDoneMessage", () => {
	it("mensagens", () => {
		expect(receiptDoneMessage("pay")).toBe("Pagamento avisado!");
		expect(receiptDoneMessage("attach")).toBe("Comprovante enviado!");
	});
});

import { receiptDoneMessage as doneMsg } from "./receipts";
describe("receiptDoneMessage (devolução)", () => {
	it("devolução tem mensagem própria", () => {
		expect(doneMsg("refund")).toBe("Devolução registrada!");
		expect(doneMsg("pay")).toBe("Pagamento avisado!");
		expect(doneMsg("attach")).toBe("Comprovante enviado!");
	});
});
