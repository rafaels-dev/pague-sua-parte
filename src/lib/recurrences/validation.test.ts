import { describe, expect, it } from "vitest";
import { parseRecurrenceInput, parseRecurrencePatch } from "./validation";

const NOW = new Date("2026-11-11T15:00:00Z");
const base = { description: " Aluguel ", amountCents: 150000, dayOfMonth: 25, participantMode: "all" };
const bad = (r: ReturnType<typeof parseRecurrenceInput>) => (r.ok ? null : [r.status, r.field]);

describe("parseRecurrenceInput", () => {
	it("aceita o mínimo e usa o início padrão", () => {
		expect(parseRecurrenceInput(base, NOW)).toEqual({
			ok: true,
			value: { description: "Aluguel", amountCents: 150000, dayOfMonth: 25, participantMode: "all", participantUids: [], startPeriod: "2026-11" },
		});
		expect(parseRecurrenceInput({ ...base, dayOfMonth: 3 }, NOW)).toMatchObject({ value: { startPeriod: "2026-12" } });
	});
	it("recusa cashback em despesa fixa", () => {
		expect(bad(parseRecurrenceInput({ ...base, cashback: { cents: 100 } }, NOW))).toEqual([422, "cashback"]);
		expect(parseRecurrenceInput({ ...base, cashback: null }, NOW).ok).toBe(true);
	});
	it("campos inválidos", () => {
		expect(bad(parseRecurrenceInput({ ...base, description: " " }, NOW))).toEqual([422, "description"]);
		expect(bad(parseRecurrenceInput({ ...base, amountCents: 0 }, NOW))).toEqual([422, "amountCents"]);
		expect(bad(parseRecurrenceInput({ ...base, dayOfMonth: 0 }, NOW))).toEqual([422, "dayOfMonth"]);
		expect(bad(parseRecurrenceInput({ ...base, dayOfMonth: 32 }, NOW))).toEqual([422, "dayOfMonth"]);
		expect(bad(parseRecurrenceInput({ ...base, dayOfMonth: 1.5 }, NOW))).toEqual([422, "dayOfMonth"]);
		expect(bad(parseRecurrenceInput({ ...base, participantMode: "x" }, NOW))).toEqual([422, "participantMode"]);
		expect(bad(parseRecurrenceInput({ ...base, participantMode: "selected" }, NOW))).toEqual([422, "participantUids"]);
		expect(bad(parseRecurrenceInput({ ...base, participantMode: "selected", participantUids: ["a", "a"] }, NOW))).toEqual([422, "participantUids"]);
		expect(bad(parseRecurrenceInput(null, NOW))).toEqual([422, "description"]);
	});
	it("participantUids só vale para selected", () => {
		expect(parseRecurrenceInput({ ...base, participantMode: "alone", participantUids: ["a"] }, NOW)).toMatchObject({ value: { participantUids: [] } });
		expect(parseRecurrenceInput({ ...base, participantMode: "selected", participantUids: ["a"], paidByUid: "m_x" }, NOW)).toMatchObject({
			value: { participantUids: ["a"], paidByUid: "m_x" },
		});
	});
	it("início: mês atual ou futuro, até 12 meses", () => {
		expect(parseRecurrenceInput({ ...base, startPeriod: "2026-11" }, NOW).ok).toBe(true);
		expect(parseRecurrenceInput({ ...base, startPeriod: "2027-11" }, NOW).ok).toBe(true);
		expect(bad(parseRecurrenceInput({ ...base, startPeriod: "2026-10" }, NOW))).toEqual([422, "startPeriod"]);
		expect(bad(parseRecurrenceInput({ ...base, startPeriod: "2027-12" }, NOW))).toEqual([422, "startPeriod"]);
		expect(bad(parseRecurrenceInput({ ...base, startPeriod: "2026-13" }, NOW))).toEqual([422, "startPeriod"]);
	});
	it("fim: não antes do início, até 5 anos", () => {
		expect(parseRecurrenceInput({ ...base, endPeriod: "2026-11" }, NOW)).toMatchObject({ value: { endPeriod: "2026-11" } });
		expect(bad(parseRecurrenceInput({ ...base, endPeriod: "2026-10" }, NOW))).toEqual([422, "endPeriod"]);
		expect(bad(parseRecurrenceInput({ ...base, startPeriod: "2027-01", endPeriod: "2026-12" }, NOW))).toEqual([422, "endPeriod"]);
		expect(parseRecurrenceInput({ ...base, endPeriod: "2031-11" }, NOW).ok).toBe(true);
		expect(bad(parseRecurrenceInput({ ...base, endPeriod: "2031-12" }, NOW))).toEqual([422, "endPeriod"]);
	});
});

describe("parseRecurrencePatch", () => {
	it("subconjunto; endPeriod null remove o fim", () => {
		expect(parseRecurrencePatch({ amountCents: 200, endPeriod: null }, NOW)).toEqual({ ok: true, value: { amountCents: 200, endPeriod: null } });
		expect(parseRecurrencePatch({ dayOfMonth: 5, description: "x" }, NOW)).toEqual({ ok: true, value: { dayOfMonth: 5, description: "x" } });
	});
	it("rejeita vazio, inválido e fim longe demais", () => {
		expect(parseRecurrencePatch({}, NOW).ok).toBe(false);
		expect(parseRecurrencePatch({ dayOfMonth: 40 }, NOW)).toMatchObject({ ok: false, field: "dayOfMonth" });
		expect(parseRecurrencePatch({ endPeriod: "2040-01" }, NOW)).toMatchObject({ ok: false, field: "endPeriod" });
		expect(parseRecurrencePatch({ endPeriod: "abc" }, NOW)).toMatchObject({ ok: false, field: "endPeriod" });
		expect(parseRecurrencePatch({ participantUids: ["a", "a"] }, NOW)).toMatchObject({ ok: false, field: "participantUids" });
	});
});
