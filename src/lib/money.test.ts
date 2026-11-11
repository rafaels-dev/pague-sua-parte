import { describe, expect, it } from "vitest";
import { formatBRL, parseBRLToCents } from "./money";

describe("formatBRL", () => {
	it("formata valores", () => {
		expect(formatBRL(0)).toBe("R$ 0,00");
		expect(formatBRL(5)).toBe("R$ 0,05");
		expect(formatBRL(123456)).toBe("R$ 1.234,56");
		expect(formatBRL(100000000)).toBe("R$ 1.000.000,00");
	});
	it("formata negativos", () => {
		expect(formatBRL(-1050)).toBe("-R$ 10,50");
	});
});

describe("parseBRLToCents", () => {
	it("aceita formatos pt-BR", () => {
		expect(parseBRLToCents("1.234,56")).toBe(123456);
		expect(parseBRLToCents("1234,56")).toBe(123456);
		expect(parseBRLToCents("10")).toBe(1000);
		expect(parseBRLToCents("10,5")).toBe(1050);
		expect(parseBRLToCents("0,05")).toBe(5);
		expect(parseBRLToCents("R$ 1.000")).toBe(100000);
		expect(parseBRLToCents("  25,00 ")).toBe(2500);
	});
	it("rejeita entradas inválidas", () => {
		for (const bad of ["", "abc", "1,234", "1.23", "1,2,3", "-5", "10,999", "1..000", ",50", "12.34.5"]) {
			expect(parseBRLToCents(bad), bad).toBeNull();
		}
	});
	it("é inverso de formatBRL", () => {
		for (const c of [0, 1, 99, 100, 123456, 987654321]) {
			expect(parseBRLToCents(formatBRL(c))).toBe(c);
		}
	});
});
