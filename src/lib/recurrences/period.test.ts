import { describe, expect, it } from "vitest";
import { addPeriods, currentPeriod, defaultStartPeriod, dueDateFor, isPeriod, periodsToGenerate, resolveParticipants } from "./period";

describe("períodos", () => {
	it("valida o formato", () => {
		expect(["2026-01", "2026-12"].every(isPeriod)).toBe(true);
		expect(["2026-13", "2026-00", "2026-1", "2026-01-01", 5, null].some(isPeriod)).toBe(false);
	});
	it("soma meses atravessando o ano", () => {
		expect(addPeriods("2026-11", 1)).toBe("2026-12");
		expect(addPeriods("2026-12", 1)).toBe("2027-01");
		expect(addPeriods("2026-01", -1)).toBe("2025-12");
		expect(addPeriods("2026-01", 25)).toBe("2028-02");
	});
	it("mês atual usa São Paulo (UTC virou o mês, lá ainda não)", () => {
		expect(currentPeriod(new Date("2026-12-01T01:00:00Z"))).toBe("2026-11");
		expect(currentPeriod(new Date("2026-12-01T03:00:00Z"))).toBe("2026-12");
	});
	it("limita o dia ao fim do mês", () => {
		expect(dueDateFor("2026-02", 31)).toBe("2026-02-28");
		expect(dueDateFor("2028-02", 31)).toBe("2028-02-29");
		expect(dueDateFor("2026-04", 31)).toBe("2026-04-30");
		expect(dueDateFor("2026-03", 31)).toBe("2026-03-31");
		expect(dueDateFor("2026-03", 5)).toBe("2026-03-05");
	});
	it("início padrão: este mês se o dia não passou, senão o próximo", () => {
		const now = new Date("2026-11-11T15:00:00Z");
		expect(defaultStartPeriod(25, now)).toBe("2026-11");
		expect(defaultStartPeriod(11, now)).toBe("2026-11");
		expect(defaultStartPeriod(10, now)).toBe("2026-12");
		expect(defaultStartPeriod(1, new Date("2026-12-20T15:00:00Z"))).toBe("2027-01");
	});
	it("meses a gerar: recupera atrasados, respeita o fim e o limite", () => {
		expect(periodsToGenerate("2026-11", "2026-10", null)).toEqual([]);
		expect(periodsToGenerate("2026-09", "2026-11", null)).toEqual(["2026-09", "2026-10", "2026-11"]);
		expect(periodsToGenerate("2026-09", "2026-11", "2026-10")).toEqual(["2026-09", "2026-10"]);
		expect(periodsToGenerate("2026-09", "2026-11", "2026-08")).toEqual([]);
		expect(periodsToGenerate("2020-01", "2026-11", null)).toHaveLength(12);
		expect(periodsToGenerate("2020-01", "2026-11", null, 3)).toEqual(["2020-01", "2020-02", "2020-03"]);
	});
	it("participantes", () => {
		const members = ["u1", "u2", "u3"];
		expect(resolveParticipants("all", [], members, "u1")).toEqual(members);
		expect(resolveParticipants("alone", ["u2"], members, "u1")).toEqual(["u1"]);
		expect(resolveParticipants("selected", ["u3", "u2"], members, "u1")).toEqual(["u3", "u2"]);
		expect(resolveParticipants("selected", ["u2", "x"], members, "u1")).toEqual(["u2"]);
		expect(resolveParticipants("selected", ["x"], members, "u1")).toEqual(["u1"]);
		expect(resolveParticipants("selected", [], members, "u1")).toEqual(["u1"]);
	});
});
