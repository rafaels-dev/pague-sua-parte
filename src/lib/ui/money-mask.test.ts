import { describe, expect, it } from "vitest";
import { centsFromTyped, maskedMoney } from "./money-mask";

describe("centsFromTyped", () => {
	it("digitar preenche os centavos", () => {
		expect(centsFromTyped("1")).toBe(1);
		expect(centsFromTyped("12")).toBe(12);
		expect(centsFromTyped("1234")).toBe(1234);
	});
	it("reaproveita o texto já formatado ao digitar mais um dígito", () => {
		expect(centsFromTyped("R$ 12,345")).toBe(12345);
		expect(centsFromTyped("R$ 1.234,5")).toBe(12345);
	});
	it("apagar um dígito do texto formatado", () => {
		expect(centsFromTyped("R$ 12,3")).toBe(123);
		expect(centsFromTyped("R$ 0,0")).toBe(0);
		expect(centsFromTyped("")).toBe(0);
	});
	it("ignora letras e zeros à esquerda", () => {
		expect(centsFromTyped("abc")).toBe(0);
		expect(centsFromTyped("0001234")).toBe(1234);
	});
	it("limita a 10 dígitos", () => {
		expect(centsFromTyped("123456789012")).toBe(1234567890);
	});
});

describe("maskedMoney", () => {
	it("vazio para zero", () => expect(maskedMoney(0)).toBe(""));
	it("formata em reais", () => {
		expect(maskedMoney(1234)).toBe("R$ 12,34");
		expect(maskedMoney(5)).toBe("R$ 0,05");
		expect(maskedMoney(123456)).toBe("R$ 1.234,56");
	});
});
