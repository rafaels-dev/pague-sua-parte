import { describe, expect, it } from "vitest";
import { formatDateLong, formatDateShort, isValidISODate, todayISO } from "./dates";

describe("todayISO", () => {
	it("usa o fuso de São Paulo", () => {
		// 02:00 UTC do dia 11 ainda é dia 10 em São Paulo (UTC-3).
		expect(todayISO(new Date("2026-11-11T02:00:00Z"))).toBe("2026-11-10");
		expect(todayISO(new Date("2026-11-11T15:00:00Z"))).toBe("2026-11-11");
	});
});

describe("formatDateShort", () => {
	const today = "2026-11-11";
	it("hoje e ontem", () => {
		expect(formatDateShort("2026-11-11", today)).toBe("Hoje");
		expect(formatDateShort("2026-11-10", today)).toBe("Ontem");
	});
	it("ontem na virada do mês", () => expect(formatDateShort("2026-10-31", "2026-11-01")).toBe("Ontem"));
	it("mesmo ano sem o ano", () => expect(formatDateShort("2026-03-05", today)).toBe("5 mar"));
	it("outro ano com o ano", () => expect(formatDateShort("2025-12-25", today)).toBe("25 dez 2025"));
	it("aceita data com hora", () => expect(formatDateShort("2026-11-11T10:00:00Z", today)).toBe("Hoje"));
	it("inválida vira vazio", () => expect(formatDateShort("abc", today)).toBe(""));
});

describe("formatDateLong", () => {
	it("por extenso", () => expect(formatDateLong("2026-03-05")).toBe("5 de março de 2026"));
	it("inválida", () => expect(formatDateLong("")).toBe(""));
});

describe("isValidISODate", () => {
	it("valida", () => {
		expect(isValidISODate("2026-02-28")).toBe(true);
		expect(isValidISODate("2026-02-30")).toBe(false);
		expect(isValidISODate("26-02-28")).toBe(false);
	});
});
