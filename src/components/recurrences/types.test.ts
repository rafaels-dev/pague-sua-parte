import { describe, expect, it } from "vitest";
import { normalizeRecurrence, normalizeRecurrenceRef, normalizeRecurrences } from "./types";

describe("normalizeRecurrence", () => {
	it("completa os campos que faltam", () => {
		const r = normalizeRecurrence({ id: "r1" })!;
		expect(r).toMatchObject({ id: "r1", description: "", amountCents: 0, dayOfMonth: 1, participantMode: "all", participantUids: [], endPeriod: null, nextDueDate: "", canEdit: false });
		expect(r.paidBy).toEqual({ uid: "", name: "", picture: null, isYou: false, kind: "user", youManage: false });
	});
	it("mantém um item completo e limita o dia", () => {
		const r = normalizeRecurrence({
			id: "r2",
			description: "Aluguel",
			amountCents: 30000,
			dayOfMonth: 45,
			participantMode: "selected",
			participantUids: ["a", 3, "b"],
			paidBy: { uid: "m1", name: "Benjamim", kind: "managed", youManage: true },
			startPeriod: "2026-11",
			endPeriod: "2027-03",
			nextDueDate: "2026-12-25T00:00:00Z",
			canEdit: true,
		})!;
		expect(r.dayOfMonth).toBe(31);
		expect(r.participantUids).toEqual(["a", "b"]);
		expect(r.paidBy.youManage).toBe(true);
		expect(r.endPeriod).toBe("2027-03");
		expect(r.nextDueDate).toBe("2026-12-25");
	});
	it("ignora fim inválido e modo desconhecido", () => {
		const r = normalizeRecurrence({ id: "r3", endPeriod: "março", participantMode: "x" })!;
		expect(r.endPeriod).toBeNull();
		expect(r.participantMode).toBe("all");
	});
	it("sem id não é item", () => {
		expect(normalizeRecurrence(null)).toBeNull();
		expect(normalizeRecurrence({})).toBeNull();
	});
});

describe("normalizeRecurrences", () => {
	it("formato inesperado vira lista vazia", () => {
		expect(normalizeRecurrences(null)).toEqual([]);
		expect(normalizeRecurrences({ recurrences: "x" })).toEqual([]);
	});
	it("descarta itens quebrados", () => {
		expect(normalizeRecurrences({ recurrences: [{ id: "a" }, {}, null] })).toHaveLength(1);
	});
});

describe("normalizeRecurrenceRef", () => {
	it("aceita e rejeita", () => {
		expect(normalizeRecurrenceRef({ id: "r1", period: "2026-11" })).toEqual({ id: "r1", period: "2026-11" });
		expect(normalizeRecurrenceRef(undefined)).toBeNull();
		expect(normalizeRecurrenceRef({ period: "2026-11" })).toBeNull();
	});
});
