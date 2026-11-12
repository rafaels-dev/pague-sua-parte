import { describe, expect, it } from "vitest";
import { buildPlanLink, buildPlanShareText, detailsSnippet, type PlanShareData } from "./plan-share";

const base: PlanShareData = {
	name: " Hotel na praia ",
	totalCents: 250000,
	eventDate: "2026-12-28",
	details: "Pousada Sol\nhttps://pousada.com.br/quartos",
	result: { expectedPeople: 10, allCount: 10, shareIfAllCents: 25000 },
};
const LINK = "https://paguesuaparte.com.br/convite/plano/abc123";

describe("texto do WhatsApp do plano", () => {
	it("traz nome, valor, data, trecho dos detalhes, previsão e o link de convite", () => {
		const t = buildPlanShareText(base, LINK);
		expect(t).toBe(
			[
				"*Hotel na praia*",
				"Valor: R$ 2.500,00",
				"Quando: 28 de dezembro de 2026",
				"Pousada Sol https://pousada.com.br/quartos",
				"",
				"Se forem 10 pessoas, fica R$ 250,00 para cada um.",
				"",
				`Diga se você vai: ${LINK}`,
			].join("\n"),
		);
	});
	it("sem data, detalhes nem previsão: linhas omitidas", () => {
		const t = buildPlanShareText({ ...base, eventDate: null, details: null, result: { ...base.result, expectedPeople: null } }, LINK);
		expect(t).not.toContain("Quando");
		expect(t).not.toContain("Se forem");
	});
	it("não leva placar: quantos vão, quantos faltam nem quanto fica hoje", () => {
		const t = buildPlanShareText(base, LINK);
		expect(t).not.toMatch(/Já vão|Não vão|Faltam responder|Por enquanto|Fecha com/);
	});
	it("nunca leva limite, chave Pix nem fotos", () => {
		const t = buildPlanShareText(base, LINK);
		expect(t).not.toMatch(/limite|pix|foto/i);
	});
	it("trecho dos detalhes é curto e numa linha só", () => {
		const long = "palavra ".repeat(100);
		const s = detailsSnippet(long)!;
		expect(Array.from(s).length).toBeLessThanOrEqual(160);
		expect(s.endsWith("…")).toBe(true);
		expect(s).not.toContain("\n");
		expect(detailsSnippet("  ")).toBeNull();
		expect(detailsSnippet(null)).toBeNull();
	});
	it("link de convite", () => {
		expect(buildPlanLink("https://x.com/", "a_b-c")).toBe("https://x.com/convite/plano/a_b-c");
	});
});
