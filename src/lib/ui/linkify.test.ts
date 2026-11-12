import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

describe("linkify", () => {
	it("texto sem link volta inteiro", () => {
		expect(linkify("Sem nada\nem duas linhas")).toEqual([{ type: "text", text: "Sem nada\nem duas linhas" }]);
		expect(linkify("")).toEqual([]);
	});
	it("vira link só http e https", () => {
		const r = linkify("Veja https://hotel.com.br/quartos e http://x.org");
		expect(r).toEqual([
			{ type: "text", text: "Veja " },
			{ type: "link", text: "https://hotel.com.br/quartos", href: "https://hotel.com.br/quartos" },
			{ type: "text", text: " e " },
			{ type: "link", text: "http://x.org", href: "http://x.org/" },
		]);
	});
	it("não cria link para outros esquemas", () => {
		for (const t of ["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://a.b/c", "mailto:a@b.c", "file:///etc/passwd"]) {
			expect(linkify(t)).toEqual([{ type: "text", text: t }]);
		}
		// mesmo escondido depois de um esquema ruim, só o trecho http(s) vira link
		expect(linkify("javascript:alert(1) https://a.b")).toEqual([
			{ type: "text", text: "javascript:alert(1) " },
			{ type: "link", text: "https://a.b", href: "https://a.b/" },
		]);
	});
	it("tira a pontuação do fim do link", () => {
		expect(linkify("Olhe https://a.b/c, depois.")).toEqual([
			{ type: "text", text: "Olhe " },
			{ type: "link", text: "https://a.b/c", href: "https://a.b/c" },
			{ type: "text", text: ", depois." },
		]);
		expect(linkify("(https://a.b/c)")[1]).toMatchObject({ type: "link", text: "https://a.b/c" });
		expect(linkify("https://a.b/c?x=1!")[0]).toMatchObject({ text: "https://a.b/c?x=1" });
	});
	it("mantém o parêntese final quando faz parte do endereço", () => {
		expect(linkify("https://pt.wikipedia.org/wiki/Foo_(bar)")[0]).toMatchObject({ type: "link", text: "https://pt.wikipedia.org/wiki/Foo_(bar)" });
	});
	it("endereço sem domínio não vira link", () => {
		expect(linkify("https://")).toEqual([{ type: "text", text: "https://" }]);
	});
	it("tags HTML ficam como texto (o React escapa)", () => {
		expect(linkify('<img src=x onerror=alert(1)> https://a.b')).toEqual([
			{ type: "text", text: "<img src=x onerror=alert(1)> " },
			{ type: "link", text: "https://a.b", href: "https://a.b/" },
		]);
	});
	it("preserva as quebras de linha ao redor do link", () => {
		const r = linkify("a\nhttps://a.b\nb");
		expect(r.map((p) => p.text).join("")).toBe("a\nhttps://a.b\nb");
	});
});
