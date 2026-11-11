import { describe, expect, it } from "vitest";
import { fairnessPercent, referenceFacet, reportPipeline, type ExpenseLike } from "./compute";
import { inPeriod, parsePeriod } from "./period";

const S = (uid: string, amountCents: number, paidCents = 0, helped?: boolean) => ({ uid, amountCents, paidCents, ...(helped ? { helped } : {}) });

/** Fixture calculada à mão (ver comentários). u1 e u2 membros, u3 membro, m_vo pessoa sem login, x1 ex-membro. */
export const FIXTURE: ExpenseLike[] = [
	// E1: u1 paga 3000, 3 partes de 1000; u2 pagou, u3 não
	{ paidBy: "u1", amountCents: 3000, date: "2026-11-10", shares: [S("u1", 1000), S("u2", 1000, 1000), S("u3", 1000)] },
	// E2: u2 paga 1200 sozinho (ninguém ajudou)
	{ paidBy: "u2", amountCents: 1200, date: "2026-11-12", shares: [S("u2", 1200)] },
	// E3 (outubro): u1 paga 1000; u3 ajudou e pagou; m_vo pagou 100 de 250; x1 pagou 300 de 250 (reembolso de 50)
	{
		paidBy: "u1",
		amountCents: 1000,
		date: "2026-10-05",
		shares: [S("u1", 250), S("u3", 250, 250, true), S("m_vo", 250, 100), S("x1", 250, 300)],
	},
];

describe("referenceFacet (fixture feita à mão)", () => {
	const f = referenceFacet(FIXTURE);
	const p = (u: string) => f.people.find((r) => r._id === u)!;
	it("totais e meses", () => {
		expect(f.totals).toEqual([{ _id: null, count: 3, total: 5200 }]);
		expect(f.months).toEqual([
			{ _id: "2026-10", total: 1000 },
			{ _id: "2026-11", total: 4200 },
		]);
	});
	it("por pessoa", () => {
		expect(p("u1")).toMatchObject({ advanced: 4000, share: 1250, born: 2350, pending: 0, owedBack: 0, helped: 0, paidCount: 2 });
		expect(p("u2")).toMatchObject({ advanced: 1200, share: 2200, born: 2200, pending: 0, paidCount: 1 });
		expect(p("u3")).toMatchObject({ advanced: 0, share: 1250, born: 250, pending: 1000, helped: 1, paidCount: 0 });
		expect(p("m_vo")).toMatchObject({ share: 250, born: 100, pending: 150 });
		expect(p("x1")).toMatchObject({ share: 250, born: 300, pending: 0, owedBack: 50 });
	});
	it("identidade: Σ born === total, com reembolso pendente e dívida em aberto", () => {
		expect(f.people.reduce((t, r) => t + r.born, 0)).toBe(5200);
		expect(f.people.reduce((t, r) => t + r.share, 0)).toBe(5200);
		// born(dono) = share + Σ pending − Σ owedBack nas despesas em que não há teto: E1 (u1): 1000 + 1000 = 2000
		expect(referenceFacet([FIXTURE[0]]).people.find((r) => r._id === "u1")!.born).toBe(2000);
	});
	it("identidade em qualquer combinação (aleatório determinístico), inclusive pago acima do total", () => {
		let seed = 7;
		const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
		for (let i = 0; i < 200; i++) {
			const amount = 100 + rnd(9000);
			const n = 1 + rnd(5);
			const uids = ["a", "b", "c", "d", "e"].slice(0, n);
			const e: ExpenseLike = {
				paidBy: "a",
				amountCents: amount,
				date: "2026-11-01",
				shares: uids.map((u, k) => S(u, Math.floor(amount / n) + (k === 0 ? amount % n : 0), u === "a" ? 0 : rnd(amount * 2))),
			};
			const r = referenceFacet([e, FIXTURE[2]]);
			expect(r.people.reduce((t, x) => t + x.born, 0)).toBe(r.totals[0].total);
		}
	});
	it("período: o filtro de mês deixa só novembro", () => {
		const nov = referenceFacet(FIXTURE.filter((e) => inPeriod(e.date, parsePeriod("month:2026-11")!)));
		expect(nov.totals[0]).toMatchObject({ count: 2, total: 4200 });
		expect(nov.people.map((r) => r._id).sort()).toEqual(["u1", "u2", "u3"]);
		expect(referenceFacet([])).toEqual({ people: [], months: [], totals: [] });
	});
	it("lê cotas do modelo antigo (status: paid)", () => {
		const legacy = { paidBy: "u1", amountCents: 200, date: "2026-11-01", shares: [{ uid: "u1", amountCents: 100 }, { uid: "u2", amountCents: 100, status: "paid" }] } as never;
		expect(referenceFacet([legacy]).people.find((r) => r._id === "u2")).toMatchObject({ born: 100, pending: 0 });
	});
	it("cota 0 de ajudante que saiu não conta como ajuda", () => {
		const e = { paidBy: "u1", amountCents: 100, date: "2026-11-01", shares: [S("u1", 100), { ...S("u2", 0, 50), helped: true }] };
		expect(referenceFacet([e]).people.find((r) => r._id === "u2")).toMatchObject({ helped: 0, born: 50, owedBack: 50 });
	});
});

describe("fairnessPercent", () => {
	it("contribuições iguais: 100", () => expect(fairnessPercent([250, 250, 250, 250], 250, 1000)).toBe(100));
	it("uma pessoa carregando tudo entre 4: 25", () => expect(fairnessPercent([1000, 0, 0, 0], 250, 1000)).toBe(25));
	it("sem gasto: 100", () => expect(fairnessPercent([0, 0], 0, 0)).toBe(100));
	it("fica entre 0 e 100 (ex-membros fora da conta podem estourar)", () => {
		expect(fairnessPercent([0, 0], 5000, 1000)).toBe(0);
		expect(fairnessPercent([1000], 1000, 1000)).toBe(100);
	});
	it("a fixture: 60", () => expect(fairnessPercent([2350, 2200, 250, 100], 1040, 5200)).toBe(60));
});

describe("reportPipeline", () => {
	it("começa pelo filtro e tem um só $facet com pessoas, meses e totais", () => {
		const pipe = reportPipeline({ groupId: 1 });
		expect(pipe[0]).toEqual({ $match: { groupId: 1 } });
		const facets = pipe.filter((s) => "$facet" in s);
		expect(facets).toHaveLength(1);
		expect(Object.keys((facets[0] as { $facet: object }).$facet)).toEqual(["people", "months", "totals"]);
		expect(JSON.stringify(pipe)).not.toMatch(/email|pix/i);
	});
});
