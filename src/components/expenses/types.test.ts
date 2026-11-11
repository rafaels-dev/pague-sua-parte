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
