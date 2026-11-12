import { describe, expect, it } from "vitest";
import { buildGroupLink, buildGroupSummaryText, normalizeGroupSummary, SUMMARY_MAX_LINES, type GroupSummaryData } from "./group-summary";

const LINK = "https://pague-sua-parte.app/app/grupos/g1";
const base: GroupSummaryData = {
	groupName: "Família Silva",
	totalOpenCents: 35000,
	overdueCents: 12000,
	debts: [
		{ fromName: "Carlos", toName: "Bruno", cents: 8000, overdue: false, refund: false },
		{ fromName: "Ana", toName: "Bruno", cents: 12000, overdue: true, refund: false },
		{ fromName: "Ana", toName: "Carla", cents: 3000, overdue: false, refund: false },
		{ fromName: "Bruno", toName: "Dora", cents: 1500, overdue: false, refund: true },
	],
	moreDebts: 0,
	upToDate: ["Dora", "Eva"],
	moreUpToDate: 0,
};

describe("buildGroupSummaryText", () => {
	it("título, total, quem deve a quem (atrasado marcado), devolução, quem está em dia e o link", () => {
		expect(buildGroupSummaryText(base, LINK)).toBe(
			[
				"*Resumo do grupo Família Silva*",
				"Ainda em aberto: *R$ 350,00*",
				"Atrasado: R$ 120,00",
				"",
				"Ana deve R$ 120,00 a Bruno (atrasado)",
				"Ana deve R$ 30,00 a Carla",
				"Bruno devolve R$ 15,00 para Dora",
				"Carlos deve R$ 80,00 a Bruno",
				"",
				"Em dia: Dora e Eva",
				"",
				`Veja os detalhes: ${LINK}`,
			].join("\n"),
		);
	});
	it("sem dívidas: tudo certo", () => {
		const t = buildGroupSummaryText({ ...base, totalOpenCents: 0, debts: [], overdueCents: 0 }, LINK);
		expect(t).toContain("Tudo certo: ninguém deve nada.");
		expect(t).not.toContain("Ainda em aberto");
	});
	it("corta em N linhas e diz 'e mais N' (inclui as que o servidor já cortou)", () => {
		const debts = Array.from({ length: 30 }, (_, i) => ({ fromName: `P${String(i).padStart(2, "0")}`, toName: "Z", cents: 100, overdue: false, refund: false }));
		const t = buildGroupSummaryText({ ...base, debts, moreDebts: 5 }, LINK);
		expect(t.split("\n").filter((l) => l.includes(" deve R$")).length).toBe(SUMMARY_MAX_LINES);
		expect(t).toContain(`e mais ${30 - SUMMARY_MAX_LINES + 5}`);
	});
	it("nunca inclui chave Pix: só os campos de nome e valor entram no texto", () => {
		const raw = { ...base, debts: [{ ...base.debts[0], pixKey: "segredo@x.com" }], pix: { key: "52998224725" } };
		expect(buildGroupSummaryText(normalizeGroupSummary(raw), LINK)).not.toMatch(/segredo|52998224725/);
	});
	it("normaliza resposta torta e monta o link do grupo", () => {
		expect(normalizeGroupSummary(null)).toMatchObject({ groupName: "Grupo", debts: [], totalOpenCents: 0, upToDate: [] });
		expect(normalizeGroupSummary({ debts: [{ cents: 0 }, null, { fromName: "A", toName: "B", cents: 5 }] }).debts).toHaveLength(1);
		expect(buildGroupLink("https://x.app/", "g 1")).toBe("https://x.app/app/grupos/g%201");
	});
	it("resumo incompleto: avisa, nunca imprime 'Em dia' nem 'Tudo certo'", () => {
		const t = buildGroupSummaryText({ ...base, partial: true }, LINK);
		expect(t).toContain("Em aberto (parcial): *R$ 350,00*");
		expect(t).toContain("resumo incompleto");
		expect(t).not.toContain("Em dia");
		const none = buildGroupSummaryText({ ...base, partial: true, debts: [], totalOpenCents: 0 }, LINK);
		expect(none).not.toContain("Tudo certo");
		expect(none).not.toContain("Em dia");
		expect(normalizeGroupSummary({ partial: true }).partial).toBe(true);
		expect(normalizeGroupSummary({}).partial).toBe(false);
	});
});
