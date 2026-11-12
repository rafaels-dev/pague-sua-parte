import { describe, expect, it } from "vitest";
import {
	buildInviteDestinationLink,
	destinationGroupId,
	expenseDestination,
	safeInviteDestination,
	expenseShareCarriesInvite,
	expenseShareLink,
	groupShareLink,
} from "./share-link";

const G = "65f1a2b3c4d5e6f7a8b9c0d1";
const E = "65f1a2b3c4d5e6f7a8b9c0d2";

describe("links compartilhados", () => {
	it("monta o link do convite com destino", () => {
		const link = buildInviteDestinationLink("https://x.com.br/", "tok", expenseDestination(G, E));
		expect(link).toBe(`https://x.com.br/convite/tok?ir=${encodeURIComponent(`/app/grupos/${G}/despesas/${E}`)}`);
	});
	it("grupo: convite com token, link simples sem", () => {
		expect(groupShareLink("https://x.com.br/", null, G)).toBe(`https://x.com.br/app/grupos/${G}`);
		expect(groupShareLink("https://x.com.br", "tok", G)).toBe(`https://x.com.br/convite/tok?ir=${encodeURIComponent(`/app/grupos/${G}`)}`);
	});
	it("despesa: só lançada, cobrança e resumo levam o convite; paguei e devolvi levam o link simples", () => {
		const simple = `https://x.com.br/app/grupos/${G}/despesas/${E}`;
		for (const k of ["launched", "manual", "summary"] as const) {
			expect(expenseShareCarriesInvite(k)).toBe(true);
			expect(expenseShareLink(k, "https://x.com.br", "tok", G, E)).toContain("/convite/tok?ir=");
			expect(expenseShareLink(k, "https://x.com.br", null, G, E)).toBe(simple);
		}
		for (const k of ["paid", "refund"] as const) {
			expect(expenseShareCarriesInvite(k)).toBe(false);
			expect(expenseShareLink(k, "https://x.com.br", "tok", G, E)).toBe(simple);
		}
	});
	it("o destino montado volta como aceito", () => {
		const link = new URL(buildInviteDestinationLink("https://x.com.br", "tok", expenseDestination(G, E)));
		expect(safeInviteDestination(link.searchParams.get("ir"), G)).toBe(`/app/grupos/${G}/despesas/${E}`);
	});
});

describe("safeInviteDestination", () => {
	it("aceita o grupo, a despesa e subpáginas do grupo do convite", () => {
		for (const p of [`/app/grupos/${G}`, `/app/grupos/${G}/despesas/${E}`, `/app/grupos/${G}/despesas/${E}/editar`, `/app/grupos/${G}/relatorio`]) {
			expect(safeInviteDestination(p, G)).toBe(p);
		}
	});
	it("recusa outro grupo, mesmo com prefixo parecido", () => {
		expect(safeInviteDestination(`/app/grupos/${G}x`, G)).toBeNull();
		expect(safeInviteDestination(`/app/grupos/${E}`, G)).toBeNull();
		expect(safeInviteDestination(`/app/grupos/${E}/despesas/${G}`, G)).toBeNull();
	});
	it("recusa tentativas de redirecionamento", () => {
		for (const p of [
			"https://evil.com",
			"//evil.com",
			`//evil.com/app/grupos/${G}`,
			`/\\evil.com`,
			`/app/grupos/${G}//evil.com`,
			`/app/grupos/${G}/\\evil.com`,
			`/app/grupos/${G}/../../x`,
			`/app/grupos/${G}/%2e%2e/x`,
			`/app/grupos/${G}?x=https://evil.com`,
			`/app/grupos/${G}#x`,
			`/app/grupos/${G}/`,
			`javascript:alert(1)`,
			`/app/grupos/${G}\n/x`,
			`/app/pagar`,
			`/app/grupos/`,
			`app/grupos/${G}`,
			"",
		]) {
			expect(safeInviteDestination(p, G), p).toBeNull();
		}
		expect(safeInviteDestination(null, G)).toBeNull();
		expect(safeInviteDestination(undefined, G)).toBeNull();
		expect(safeInviteDestination("/app/grupos/" + G + "/a".repeat(200), G)).toBeNull();
	});
	it("decodifica uma vez só (quem chama); texto ainda codificado é recusado", () => {
		expect(safeInviteDestination(encodeURIComponent(`/app/grupos/${G}`), G)).toBeNull();
	});
});

describe("destinationGroupId", () => {
	it("extrai o grupo só de destinos bem formados", () => {
		expect(destinationGroupId(`/app/grupos/${G}/despesas/${E}`)).toBe(G);
		expect(destinationGroupId("//evil.com")).toBeNull();
		expect(destinationGroupId(null)).toBeNull();
	});
});

describe("textos com o link do convite", () => {
	const link = buildInviteDestinationLink("https://x.com.br", "tok", expenseDestination(G, E));
	it("a despesa leva o convite no texto e nenhuma chave Pix", async () => {
		const { buildExpenseShareText } = await import("./expense-share");
		const text = buildExpenseShareText({ amountCents: 1000, description: "Pizza" }, link);
		expect(text).toContain(link);
		expect(text).not.toMatch(/pix\s*[:=]/i);
	});
	it("o resumo do grupo leva o convite", async () => {
		const { buildGroupSummaryText } = await import("./group-summary");
		const text = buildGroupSummaryText(
			{ groupName: "Casa", totalOpenCents: 0, overdueCents: 0, debts: [], moreDebts: 0, upToDate: [], moreUpToDate: 0, expenses: [], moreExpenses: 0, upcoming: [], moreUpcoming: 0, upcomingTotalCents: 0 },
			groupShareLink("https://x.com.br", "tok", G),
		);
		expect(text).toContain(`/convite/tok?ir=${encodeURIComponent(`/app/grupos/${G}`)}`);
	});
});
