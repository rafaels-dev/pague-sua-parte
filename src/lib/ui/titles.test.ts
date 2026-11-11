import { describe, expect, it } from "vitest";
import { screenInfo } from "./titles";

describe("screenInfo", () => {
	it("home", () => expect(screenInfo("/app")).toEqual({ title: "Pague Sua Parte", back: null, nav: "/app" }));
	it("perfil", () => expect(screenInfo("/app/perfil").nav).toBe("/app/perfil"));
	it("novo grupo volta ao início", () => {
		expect(screenInfo("/app/grupos/novo")).toMatchObject({ title: "Criar grupo", back: "/app" });
	});
	it("grupo", () => expect(screenInfo("/app/grupos/abc")).toMatchObject({ title: "Grupo", back: "/app", nav: "/app" }));
	it("lançar despesa volta ao grupo", () => {
		expect(screenInfo("/app/grupos/abc/despesas/nova")).toMatchObject({ title: "Lançar despesa", back: "/app/grupos/abc", nav: "/app" });
	});
	it("despesa volta ao grupo", () => {
		expect(screenInfo("/app/grupos/abc/despesas/e1")).toMatchObject({ title: "Despesa", back: "/app/grupos/abc" });
	});
});
