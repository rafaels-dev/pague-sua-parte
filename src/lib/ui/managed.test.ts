import { describe, expect, it } from "vitest";
import { managedCaption, managedLines, normalizeMeSummary, ownerViewStatus } from "./managed";

describe("managedCaption", () => {
	it("null para quem tem celular", () => {
		expect(managedCaption({ kind: "user" })).toBeNull();
		expect(managedCaption({})).toBeNull();
	});
	it("quem você cuida", () => {
		expect(managedCaption({ kind: "managed", youManage: true })).toBe("Sem celular · você cuida");
	});
	it("aos cuidados de outra pessoa", () => {
		expect(managedCaption({ kind: "managed", managedByName: "Renata" })).toBe("Sem celular · aos cuidados de Renata");
		expect(managedCaption({ kind: "managed" })).toBe("Sem celular");
	});
});

describe("managedLines", () => {
	it("mostra dívida e devolução, ignora quem está em dia", () => {
		const lines = managedLines([
			{ uid: "b", name: "Benjamim", status: "pending", dueCents: 2500, refundCents: 0 },
			{ uid: "c", name: "Rita", status: "refund", dueCents: 0, refundCents: 500 },
			{ uid: "d", name: "Paulo", status: "paid", dueCents: 0, refundCents: 0 },
		]);
		expect(lines).toEqual([
			{ text: "Benjamim deve R$ 25,00", tone: "owe" },
			{ text: "Rita: a receber de volta R$ 5,00", tone: "ok" },
		]);
	});
});

describe("ownerViewStatus", () => {
	it("faltam pagamentos", () => {
		expect(ownerViewStatus("Benjamim", { pendingCount: 3, refundCount: 0 })).toEqual({ text: "Benjamim pagou · faltam 3 pagamentos", tone: "wait" });
		expect(ownerViewStatus("Benjamim", { pendingCount: 1, refundCount: 0 }).text).toBe("Benjamim pagou · falta 1 pagamento");
	});
	it("devoluções", () => {
		expect(ownerViewStatus("Benjamim", { pendingCount: 0, refundCount: 2 })).toEqual({ text: "Benjamim pagou · devolver para 2 pessoas", tone: "owe" });
		expect(ownerViewStatus("Benjamim", { pendingCount: 2, refundCount: 1 }).text).toBe("Benjamim pagou · faltam 2 pagamentos e 1 devolução");
	});
	it("tudo pago", () => {
		expect(ownerViewStatus("Benjamim", { pendingCount: 0, refundCount: 0 })).toEqual({ text: "Benjamim pagou · tudo pago", tone: "ok" });
	});
});

describe("normalizeMeSummary", () => {
	it("formato antigo vira lista vazia", () => {
		expect(normalizeMeSummary({ toReceiveCents: 100, toPayCents: 50 })).toEqual({
			toReceiveCents: 100,
			toPayCents: 50,
			toReceiveNowCents: 100,
			toPayNowCents: 50,
			overdueToPayCents: 0,
			managed: [],
		});
	});
	it("lixo não quebra", () => {
		expect(normalizeMeSummary(null).managed).toEqual([]);
		expect(normalizeMeSummary({ managed: [null, { uid: 1 }, { uid: "b", groupId: "g", name: "Ben" }] }).managed).toEqual([
			{ uid: "b", name: "Ben", groupId: "g", groupName: "", toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 },
		]);
	});
	it("aceita os valores de agora e o vencido, no topo e em quem você cuida", () => {
		const s = normalizeMeSummary({
			toReceiveCents: 1000,
			toPayCents: 5000,
			toReceiveNowCents: 400,
			toPayNowCents: 2000,
			overdueToPayCents: 700,
			managed: [{ uid: "b", groupId: "g", toPayCents: 900, toPayNowCents: 100, overdueToPayCents: 50 }],
		});
		expect(s).toMatchObject({ toReceiveNowCents: 400, toPayNowCents: 2000, overdueToPayCents: 700 });
		expect(s.managed[0]).toMatchObject({ toReceiveNowCents: 0, toPayNowCents: 100, overdueToPayCents: 50 });
	});
});
