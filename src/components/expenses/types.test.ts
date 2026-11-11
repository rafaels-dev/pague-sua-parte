import { describe, expect, it } from "vitest";
import { normalizeExpense, normalizeSummary } from "./types";

describe("normalizeExpense", () => {
	it("completa o formato antigo sem quebrar", () => {
		const e = normalizeExpense({
			id: "e",
			shares: [
				{ uid: "a", name: "A", amountCents: 1000, status: "payer", isYou: true },
				{ uid: "b", name: "B", amountCents: 1000, status: "pending" },
				{ uid: "c", name: "C", amountCents: 1000, status: "paid" },
			],
		});
		expect(e.canEditParticipants).toBe(false);
		expect(e.participantUids).toEqual(["a", "b", "c"]);
		expect(e.attachments).toEqual([]);
		expect(e.shares[1]).toMatchObject({ paidCents: 0, dueCents: 1000, refundCents: 0, participates: true });
		expect(e.shares[2]).toMatchObject({ paidCents: 1000, dueCents: 0 });
	});
	it("mantém os valores do servidor", () => {
		const e = normalizeExpense({
			shares: [{ uid: "b", name: "B", amountCents: 0, status: "refund", paidCents: 500, dueCents: 0, refundCents: 500, participates: false }],
			canEditParticipants: true,
			participantUids: ["a"],
		});
		expect(e.shares[0]).toMatchObject({ refundCents: 500, participates: false, status: "refund" });
		expect(e.participantUids).toEqual(["a"]);
		expect(e.canEditParticipants).toBe(true);
	});
});

describe("normalizeSummary", () => {
	it("completa os campos novos", () => {
		const s = normalizeSummary({ id: "x", yourStatus: "pending", yourShareCents: 700 });
		expect(s).toMatchObject({ yourDueCents: 700, yourRefundCents: 0, refundCount: 0, pendingCount: 0 });
	});
});

describe("vencimentos e parcelas", () => {
	it("formato antigo: sem vencimento, sem parcela, não vencida", () => {
		const e = normalizeExpense({ id: "e", shares: [] });
		expect(e).toMatchObject({ dueDate: null, installment: null, overdue: false, series: null });
		const s = normalizeSummary({ id: "x", yourStatus: "pending", yourShareCents: 700 });
		expect(s).toMatchObject({ dueDate: null, installment: null, overdue: false, settled: false });
	});
	it("settled é deduzido quando o servidor não manda", () => {
		expect(normalizeSummary({ id: "x", yourStatus: "payer", pendingCount: 0, refundCount: 0 }).settled).toBe(true);
		expect(normalizeSummary({ id: "x", yourStatus: "payer", pendingCount: 2 }).settled).toBe(false);
		expect(normalizeSummary({ id: "x", yourStatus: "refund" }).settled).toBe(false);
		expect(normalizeSummary({ id: "x", yourStatus: "paid", settled: false }).settled).toBe(false);
	});
	it("aceita os campos novos e ordena a série", () => {
		const e = normalizeExpense({
			id: "e",
			dueDate: "2026-12-10",
			overdue: true,
			installment: { seriesId: "s", number: 2, count: 3 },
			series: {
				count: 3,
				items: [
					{ id: "b", number: 2, dueDate: "2027-01-10", settled: false },
					{ id: "a", number: 1, dueDate: "2026-12-10", settled: true },
					{ id: "c", number: 3, dueDate: null, settled: false },
				],
			},
		});
		expect(e.dueDate).toBe("2026-12-10");
		expect(e.overdue).toBe(true);
		expect(e.installment).toEqual({ seriesId: "s", number: 2, count: 3 });
		expect(e.series?.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
	});
	it("parcela quebrada vira nula", () => {
		expect(normalizeExpense({ id: "e", installment: { number: 0 } as never }).installment).toBeNull();
		expect(normalizeSummary({ id: "x", installment: "oi" as never }).installment).toBeNull();
	});
});
