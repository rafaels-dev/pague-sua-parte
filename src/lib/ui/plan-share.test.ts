import { describe, expect, it } from "vitest";
import { buildPlanLink, buildPlanShareText, detailsSnippet, type PlanShareData } from "./plan-share";

const base: PlanShareData = {
	name: " Hotel na praia ",
	totalCents: 250000,
	eventDate: "2026-12-28",
	details: "Pousada Sol\nhttps://pousada.com.br/quartos",
	result: { fits: true, shareCents: 27778, includedCount: 9, goingCount: 9, pendingCount: 1, notGoingCount: 0, expectedPeople: 10, allCount: 10, shareIfAllCents: 25000, answeredCount: 9, missingCount: 1 },
};
const LINK = "https://paguesuaparte.com.br/convite/plano/abc123";

describe("texto do WhatsApp do plano", () => {
	it("traz nome, valor, data, trecho dos detalhes, previsão, placar e o link de convite", () => {
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
				"Já vão: 9",
				"Faltam responder: 1",
				"Por enquanto: Fecha com 9 pessoas · R$ 277,78 cada",
				"",
				`Diga se você vai: ${LINK}`,
			].join("\n"),
		);
	});
	it("sem data, detalhes nem previsão: linhas omitidas", () => {
		const t = buildPlanShareText({ ...base, eventDate: null, details: null, result: { ...base.result, expectedPeople: null, fits: false, shareCents: null, includedCount: 0, notGoingCount: 2 } }, LINK);
		expect(t).not.toContain("Quando");
		expect(t).not.toContain("Se forem");
		expect(t).toContain("Não vão: 2");
		expect(t).toContain("Por enquanto: Ainda não fecha");
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
