import { describe, expect, it } from "vitest";
import { detectPixKeyType, normalizePixKey } from "./key";

describe("normalizePixKey", () => {
	it("CPF válido, com ou sem máscara", () => {
		expect(normalizePixKey("529.982.247-25")).toEqual({ type: "cpf", key: "52998224725" });
		expect(normalizePixKey(" 52998224725 ")).toEqual({ type: "cpf", key: "52998224725" });
	});
	it("CPF inválido que não é celular é rejeitado", () => {
		expect(normalizePixKey("12345678900")).toBeNull();
		expect(normalizePixKey("52998224726")?.type).toBe("phone"); // não é CPF, mas parece celular
		expect(normalizePixKey("11111111111")).toBeNull();
		expect(normalizePixKey("00000000000")).toBeNull();
	});
	it("CNPJ válido e inválido", () => {
		expect(normalizePixKey("11.222.333/0001-81")).toEqual({ type: "cnpj", key: "11222333000181" });
		expect(normalizePixKey("11222333000182")).toBeNull();
		expect(normalizePixKey("00000000000000")).toBeNull();
	});
	it("e-mail em minúsculas, limite de 77", () => {
		expect(normalizePixKey("  Maria@Exemplo.COM ")).toEqual({ type: "email", key: "maria@exemplo.com" });
		expect(normalizePixKey("a@b")).toBeNull();
		expect(normalizePixKey("sem espaco@x.com")).toBeNull();
		const long = `${"a".repeat(71)}@ex.com`;
		expect(long.length).toBeGreaterThan(77);
		expect(normalizePixKey(long)).toBeNull();
		expect(normalizePixKey(`${"a".repeat(64)}@ex.com`)).not.toBeNull();
	});
	it("celular em vários formatos", () => {
		const expected = { type: "phone", key: "+5531999998888" };
		expect(normalizePixKey("(31) 99999-8888")).toEqual(expected);
		expect(normalizePixKey("31999998888")).toEqual(expected);
		expect(normalizePixKey("+5531999998888")).toEqual(expected);
		expect(normalizePixKey("+55 (31) 99999-8888")).toEqual(expected);
		expect(normalizePixKey("5531999998888")).toEqual(expected);
	});
	it("celular inválido", () => {
		expect(normalizePixKey("3199998888")).toBeNull(); // sem o 9
		expect(normalizePixKey("(31) 89999-8888")).toBeNull();
		expect(normalizePixKey("+5431999998888")).toBeNull();
		expect(normalizePixKey("+553199999888")).toBeNull();
		expect(normalizePixKey("(00) 99999-8888")).toBeNull();
	});
	it("chave aleatória UUID v4", () => {
		expect(normalizePixKey("123E4567-E89B-42D3-A456-426614174000")).toEqual({
			type: "random",
			key: "123e4567-e89b-42d3-a456-426614174000",
		});
		expect(normalizePixKey("123e4567-e89b-12d3-a456-426614174000")).toBeNull();
		expect(normalizePixKey("123e4567-e89b-42d3-c456-426614174000")).toBeNull();
	});
	it("lixo e vazio", () => {
		expect(normalizePixKey("")).toBeNull();
		expect(normalizePixKey("   ")).toBeNull();
		expect(normalizePixKey("abc")).toBeNull();
		expect(normalizePixKey("123")).toBeNull();
		expect(normalizePixKey("529.982.247-25 abc")).toBeNull();
	});
});

describe("detectPixKeyType", () => {
	it("retorna o tipo ou null", () => {
		expect(detectPixKeyType("52998224725")).toBe("cpf");
		expect(detectPixKeyType("31999998888")).toBe("phone");
		expect(detectPixKeyType("a@b.com")).toBe("email");
		expect(detectPixKeyType("xyz")).toBeNull();
	});
});
