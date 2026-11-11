import { describe, expect, it } from "vitest";
import { listStatus, paidByLabel, shareStatusChip } from "./expense-status";

const base = { yourShareCents: 0, pendingCount: 0 } as const;

describe("listStatus", () => {
	it("quem deve vê o valor", () => {
		expect(listStatus({ yourStatus: "pending", yourShareCents: 2550, pendingCount: 2 })).toEqual({ text: "Você deve R$ 25,50", tone: "owe" });
	});
	it("quem deve só a diferença vê a diferença", () => {
		expect(listStatus({ yourStatus: "pending", yourShareCents: 2500, yourDueCents: 500, pendingCount: 1 })?.text).toBe("Você deve R$ 5,00");
	});
	it("a receber de volta", () => {
		expect(listStatus({ ...base, yourStatus: "refund", yourRefundCents: 500 })).toEqual({ text: "A receber de volta R$ 5,00", tone: "ok" });
	});
	it("quem pagou vê quantos faltam", () => {
		expect(listStatus({ ...base, yourStatus: "payer", pendingCount: 3 })).toEqual({ text: "Faltam 3 pagamentos", tone: "wait" });
		expect(listStatus({ ...base, yourStatus: "payer", pendingCount: 1 })?.text).toBe("Falta 1 pagamento");
	});
	it("quem pagou vê para quantas pessoas deve devolver", () => {
		expect(listStatus({ ...base, yourStatus: "payer", refundCount: 2 })).toEqual({ text: "Devolver para 2 pessoas", tone: "owe" });
		expect(listStatus({ ...base, yourStatus: "payer", refundCount: 1 })?.text).toBe("Devolver para 1 pessoa");
	});
	it("quem pagou com os dois pendentes", () => {
		expect(listStatus({ ...base, yourStatus: "payer", pendingCount: 2, refundCount: 1 })?.text).toBe("Faltam 2 pagamentos e 1 devolução");
	});
	it("tudo pago", () => {
		expect(listStatus({ ...base, yourStatus: "payer" })).toEqual({ text: "Tudo pago", tone: "ok" });
	});
	it("quem já pagou", () => expect(listStatus({ yourStatus: "paid", yourShareCents: 100, pendingCount: 1 })?.tone).toBe("ok"));
	it("quem não participa não vê nada", () => expect(listStatus({ ...base, yourStatus: "none", pendingCount: 1 })).toBeNull());
});

describe("paidByLabel", () => {
	it("você", () => expect(paidByLabel({ name: "Rafael", isYou: true })).toBe("Você pagou"));
	it("outra pessoa", () => expect(paidByLabel({ name: "Maria", isYou: false })).toBe("Pago por Maria"));
});

describe("shareStatusChip", () => {
	it("textos", () => {
		expect(shareStatusChip("payer").text).toBe("Pagou a conta");
		expect(shareStatusChip("pending")).toEqual({ text: "Falta pagar", tone: "wait" });
		expect(shareStatusChip("paid").text).toBe("Pago");
	});
	it("dívida parcial mostra o valor; dívida inteira não", () => {
		expect(shareStatusChip("pending", { amountCents: 2000, dueCents: 500 }).text).toBe("Falta pagar R$ 5,00");
		expect(shareStatusChip("pending", { amountCents: 2000, dueCents: 2000 }).text).toBe("Falta pagar");
	});
	it("a receber de volta", () => {
		expect(shareStatusChip("refund", { refundCents: 2500 }).text).toBe("A receber de volta R$ 25,00");
	});
	it("quem saiu da divisão e foi reembolsado", () => {
		expect(shareStatusChip("paid", { participates: false }).text).toBe("Devolvido");
	});
});
