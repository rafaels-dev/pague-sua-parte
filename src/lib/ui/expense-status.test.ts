import { describe, expect, it } from "vitest";
import { listStatus, paidByLabel, shareStatusChip } from "./expense-status";

describe("listStatus", () => {
	it("quem deve vê o valor", () => {
		expect(listStatus({ yourStatus: "pending", yourShareCents: 2550, pendingCount: 2 })).toEqual({ text: "Você deve R$ 25,50", tone: "owe" });
	});
	it("quem pagou vê quantos faltam", () => {
		expect(listStatus({ yourStatus: "payer", yourShareCents: 0, pendingCount: 3 })).toEqual({ text: "Faltam 3 pagamentos", tone: "wait" });
		expect(listStatus({ yourStatus: "payer", yourShareCents: 0, pendingCount: 1 })?.text).toBe("Falta 1 pagamento");
	});
	it("tudo pago", () => {
		expect(listStatus({ yourStatus: "payer", yourShareCents: 0, pendingCount: 0 })).toEqual({ text: "Tudo pago", tone: "ok" });
	});
	it("quem já pagou", () => expect(listStatus({ yourStatus: "paid", yourShareCents: 100, pendingCount: 1 })?.tone).toBe("ok"));
	it("quem não participa não vê nada", () => expect(listStatus({ yourStatus: "none", yourShareCents: 0, pendingCount: 1 })).toBeNull());
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
});
