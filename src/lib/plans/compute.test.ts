import { describe, expect, it } from "vitest";
import { computePlan, maxShare, type PlanAnswer } from "./compute";

const P = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const yes = (who: string, limitCents?: number): PlanAnswer => ({ who, going: true, ...(limitCents ? { limitCents } : {}) });
const no = (who: string): PlanAnswer => ({ who, going: false });

describe("maxShare", () => {
	it("divide em centavos e devolve a maior parte", () => {
		expect(maxShare(250000, 10)).toBe(25000);
		expect(maxShare(250000, 9)).toBe(27778); // 277,77... arredonda para cima
		expect(maxShare(100, 3)).toBe(34);
		expect(maxShare(5, 6)).toBeNull();
		expect(maxShare(100, 0)).toBeNull();
	});
});

describe("computePlan", () => {
	it("sem respostas: não fecha, nada incluído, mas mostra o valor se todos forem", () => {
		const r = computePlan(250000, P(10), []);
		expect(r).toMatchObject({ fits: false, includedUids: [], shareCents: null, goingUids: [], aboveLimitUids: [], shareIfAllCents: 25000, hint: null, peopleCount: 10 });
	});
	it("todos dizem Vou sem limite: fecha com todos", () => {
		const r = computePlan(250000, P(10), P(10).map((p) => yes(p)));
		expect(r).toMatchObject({ fits: true, shareCents: 25000, aboveLimitUids: [] });
		expect(r.includedUids).toHaveLength(10);
	});
	it("fecha com 1 pessoa quando só ela vai e não tem limite", () => {
		const r = computePlan(250000, P(10), [yes("p3")]);
		expect(r).toMatchObject({ fits: true, includedUids: ["p3"], shareCents: 250000 });
		expect(r.hint).toEqual({ extraPeople: 1, shareCents: 125000 });
	});
	it("o limite baixo deixa a pessoa de fora e o resto fecha", () => {
		// 10 pessoas, total 2500: p10 só paga 200. Com 9: 277,78 (limite dos outros 300).
		const answers = [...P(9).map((p) => yes(p, 30000)), yes("p10", 20000)];
		const r = computePlan(250000, P(10), answers);
		expect(r.fits).toBe(true);
		expect(r.includedUids).toEqual(P(9));
		expect(r.shareCents).toBe(27778);
		expect(r.aboveLimitUids).toEqual(["p10"]);
		// se ela entrasse, seriam 10 pessoas: 250,00 (ainda acima dos 200 dela)
		expect(r.shareIfIncluded).toEqual({ p10: 25000 });
	});
	it("o maior conjunto vence, não o primeiro que cabe", () => {
		// limites 300, 300, 300, 100: k=4 -> 625 > 100; k=3 -> 833 > 300?? total 1000: parte(3)=334 > 300; k=2 -> 500 > 300; k=1 -> 1000 > 300
		const r = computePlan(100000, P(4), [yes("p1", 30000), yes("p2", 30000), yes("p3", 30000), yes("p4", 10000)]);
		expect(r.fits).toBe(false);
		// total 600: k=4 -> 150 (limite do 4º é 100: não); k=3 -> 200 <= 300: fecha com 3
		const r2 = computePlan(60000, P(4), [yes("p1", 30000), yes("p2", 30000), yes("p3", 30000), yes("p4", 10000)]);
		expect(r2).toMatchObject({ fits: true, shareCents: 20000, aboveLimitUids: ["p4"] });
		expect(r2.includedUids).toEqual(["p1", "p2", "p3"]);
	});
	it("mais pessoas baixam a parte: conjunto maior pode caber onde o menor não cabia", () => {
		// p1 limite 150, p2 sem limite, p3 sem limite; total 300: k=3 -> 100 <= 150 fecha com 3 (k=1 não caberia: 300)
		const r = computePlan(30000, P(3), [yes("p1", 15000), yes("p2"), yes("p3")]);
		expect(r).toMatchObject({ fits: true, shareCents: 10000 });
		expect(r.includedUids).toHaveLength(3);
	});
	it("ordem estável: quem tem mais limite entra primeiro; empate segue a ordem das pessoas", () => {
		const r = computePlan(30000, P(3), [yes("p1", 20000), yes("p2", 20000), yes("p3", 20000)]);
		// k=3: 100 <= 200: todos
		expect(r.includedUids).toEqual(["p1", "p2", "p3"]);
	});
	it("não fecha: dica com mais pessoas e valor", () => {
		// 2 pessoas vão, limite 100 cada, total 300 (3 pessoas no plano -> 4 pessoas)
		const r = computePlan(30000, P(5), [yes("p1", 10000), yes("p2", 10000)]);
		expect(r.fits).toBe(false);
		expect(r.includedUids).toEqual([]);
		expect(r.shareCents).toBeNull();
		// com mais 1 pessoa sem limite: k=3, 100 cabe nos dois de 100? sim, e o sem limite
		expect(r.hint).toEqual({ extraPeople: 1, shareCents: 10000 });
		// ninguém ficou acima: partes com 2 seria 150 > 100 dos dois
		expect(r.aboveLimitUids.sort()).toEqual(["p1", "p2"]);
		expect(r.shareIfIncluded).toEqual({ p1: 15000, p2: 15000 });
	});
	it("a dica nunca pede mais gente do que existe no plano", () => {
		const r = computePlan(1000000, P(2), [yes("p1", 100)]);
		expect(r.fits).toBe(false);
		expect(r.hint).toBeNull(); // só mais 1 pessoa existe e ainda não fecha (parte 5000,00 > limite 1,00)
	});
	it("a dica não conta quem disse Não vou; conta quem ainda não respondeu", () => {
		// p1 (limite 100) vai, p2 não vai, p3 não respondeu: só p3 pode entrar (2 pessoas = 150 > 100). Com 3 caberia, mas p2 disse não.
		const r = computePlan(30000, P(3), [yes("p1", 10000), no("p2")]);
		expect(r.hint).toBeNull();
		// se p2 ainda não tivesse respondido, a dica existiria (mais 2 pessoas = 100 cada)
		expect(computePlan(30000, P(3), [yes("p1", 10000)]).hint).toEqual({ extraPeople: 2, shareCents: 10000 });
	});
	it("a dica usa a previsão do criador para pessoas que ainda nem entraram", () => {
		const base = computePlan(30000, P(2), [yes("p1", 10000), yes("p2", 10000)]);
		expect(base.hint).toBeNull(); // ninguém mais no plano
		const withExpected = computePlan(30000, P(2), [yes("p1", 10000), yes("p2", 10000)], { expectedPeople: 5 });
		expect(withExpected.hint).toEqual({ extraPeople: 1, shareCents: 10000 });
	});
	it("dica limitada a 30 pessoas", () => {
		const r = computePlan(10_000_000, P(60), [yes("p1", 1000)]);
		// com 31+ pessoas a parte passaria de R$ 1,00? 10.000.000/31 muito maior que 1000 -> sem dica
		expect(r.hint).toBeNull();
	});
	it("fecha e ainda mostra quanto cairia com mais uma pessoa", () => {
		const r = computePlan(250000, P(10), P(9).map((p) => yes(p)));
		expect(r.fits).toBe(true);
		expect(r.hint).toEqual({ extraPeople: 1, shareCents: 25000 });
	});
	it("quem disse que não vai não entra na conta nem em acima do limite", () => {
		const r = computePlan(100000, P(4), [yes("p1"), yes("p2"), no("p3")]);
		expect(r).toMatchObject({ fits: true, shareCents: 50000 });
		expect(r.includedUids).toEqual(["p1", "p2"]);
		expect(r.goingUids).toEqual(["p1", "p2"]);
	});
	it("respostas de quem não está mais no plano são ignoradas", () => {
		const r = computePlan(100000, ["p1", "p2"], [yes("p1"), yes("saiu"), yes("p2")]);
		expect(r.includedUids).toEqual(["p1", "p2"]);
		expect(r.goingUids).toEqual(["p1", "p2"]);
		expect(r.peopleCount).toBe(2);
	});
	it("pessoas sem celular contam como pessoas na divisão", () => {
		const r = computePlan(90000, ["a", "b", "pg_x"], [yes("a"), yes("b"), yes("pg_x")]);
		expect(r).toMatchObject({ fits: true, shareCents: 30000, shareIfAllCents: 30000 });
	});
	it("não fecha quando o valor é menor que o número de pessoas", () => {
		const r = computePlan(2, P(3), P(3).map((p) => yes(p)));
		// 3 pessoas não dá (1 centavo cada falta); com 2, cada uma paga 1 centavo
		expect(r.includedUids).toHaveLength(2);
		expect(computePlan(2, P(3), [yes("p1", 1), yes("p2", 1), yes("p3", 1)]).shareCents).toBe(1);
	});
	it("a parte bate com a divisão da despesa (nunca passa do máximo da divisão)", () => {
		for (const [total, n] of [[100000, 3], [250001, 7], [99999, 13]] as const) {
			const r = computePlan(total, P(n), P(n).map((p) => yes(p)));
			expect(r.shareCents! * n).toBeGreaterThanOrEqual(total);
			expect(r.shareCents! * n - total).toBeLessThan(n);
		}
	});
	it("limite zero ou negativo vale como sem limite", () => {
		const r = computePlan(1000, ["a"], [{ who: "a", going: true, limitCents: 0 }]);
		expect(r.fits).toBe(true);
	});
	it("tudo igual para não-fecha: parte com todos que disseram Vou para quem está acima", () => {
		const r = computePlan(100000, P(3), [yes("p1", 1000), yes("p2", 1000), yes("p3")]);
		// k=3: 333,34 > 10; k=2 (p3 + p1): 500 > 10; k=1 (p3 sem limite): 1000 fecha
		expect(r.fits).toBe(true);
		expect(r.includedUids).toEqual(["p3"]);
		expect(r.aboveLimitUids).toEqual(["p1", "p2"]);
		expect(r.shareIfIncluded).toEqual({ p1: 50000, p2: 50000 });
	});
});
