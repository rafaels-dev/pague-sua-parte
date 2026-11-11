import { describe, expect, it } from "vitest";
import { loginUrlFor, safeReturnPath } from "./return-to";

describe("safeReturnPath", () => {
	it("aceita caminhos do app", () => {
		expect(safeReturnPath("/app/grupos/1/despesas/2")).toBe("/app/grupos/1/despesas/2");
		expect(safeReturnPath("/app/grupos/1?x=1#y")).toBe("/app/grupos/1?x=1#y");
	});
	it("recusa o que não é do app", () => {
		for (const bad of [null, undefined, "", "/", "/app", "app/grupos/1", "/perfil", "/apple/x", "https://evil.com/app/x", "javascript:alert(1)"]) {
			expect(safeReturnPath(bad as string)).toBeNull();
		}
	});
	it("recusa barras duplas, barra invertida e caracteres de controle", () => {
		for (const bad of ["//evil.com", "/app//evil.com", "/app/\\evil.com", "/app/x\n", "/app/x\u0000", "/app/../x", "/app/x/./y"]) {
			expect(safeReturnPath(bad)).toBeNull();
		}
	});
	it("recusa texto enorme", () => expect(safeReturnPath("/app/" + "a".repeat(600))).toBeNull());
});

describe("loginUrlFor", () => {
	it("lembra o caminho", () => {
		expect(loginUrlFor("/app/grupos/1/despesas/2")).toBe("/?voltar=%2Fapp%2Fgrupos%2F1%2Fdespesas%2F2");
	});
	it("cai em / se não for aceito", () => {
		expect(loginUrlFor("//evil.com")).toBe("/");
		expect(loginUrlFor("/app")).toBe("/");
	});
});
