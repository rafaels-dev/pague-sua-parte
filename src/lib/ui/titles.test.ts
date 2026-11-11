import { describe, expect, it } from "vitest";
import { screenInfo } from "./titles";

describe("screenInfo", () => {
	it("home", () => expect(screenInfo("/app")).toEqual({ title: "PagueSuaParte", back: null, nav: "/app" }));
	it("perfil", () => expect(screenInfo("/app/perfil").nav).toBe("/app/perfil"));
	it("novo grupo volta ao início", () => {
		expect(screenInfo("/app/grupos/novo")).toMatchObject({ title: "Criar grupo", back: "/app" });
	});
	it("pagar tudo volta ao início", () => {
		expect(screenInfo("/app/pagar")).toEqual({ title: "Pagar tudo", back: "/app", nav: "/app" });
	});
	it("quem me deve volta ao início", () => {
		expect(screenInfo("/app/receber")).toEqual({ title: "Quem me deve", back: "/app", nav: "/app" });
	});
	it("grupo", () => expect(screenInfo("/app/grupos/abc")).toMatchObject({ title: "Grupo", back: "/app", nav: "/app" }));
	it("lançar despesa volta ao grupo", () => {
		expect(screenInfo("/app/grupos/abc/despesas/nova")).toMatchObject({ title: "Lançar despesa", back: "/app/grupos/abc", nav: "/app" });
	});
	it("relatório volta ao grupo", () => {
		expect(screenInfo("/app/grupos/abc/relatorio")).toMatchObject({ title: "Relatório", back: "/app/grupos/abc", nav: "/app" });
	});
	it("despesa volta ao grupo", () => {
		expect(screenInfo("/app/grupos/abc/despesas/e1")).toMatchObject({ title: "Despesa", back: "/app/grupos/abc" });
	});
	it("pagar tudo e quem me deve de um grupo voltam para o grupo", () => {
		const id = "0123456789abcdef01234567";
		expect(screenInfo("/app/pagar", `?grupo=${id}`)).toEqual({ title: "Pagar tudo", back: `/app/grupos/${id}`, nav: "/app" });
		expect(screenInfo("/app/receber", `?grupo=${id}`)).toEqual({ title: "Quem me deve", back: `/app/grupos/${id}`, nav: "/app" });
	});
	it("?grupo inválido ou em outra tela é ignorado", () => {
		expect(screenInfo("/app/pagar", "?grupo=../../x").back).toBe("/app");
		expect(screenInfo("/app/receber", "?grupo=").back).toBe("/app");
		expect(screenInfo("/app/perfil", "?grupo=0123456789abcdef01234567").back).toBeNull();
	});
});
