import { describe, expect, it } from "vitest";
import { sharePreview } from "./preview";

const AT = new Date();
const mk = (uids: string[], resp: [string, boolean, number?][], over: { totalCents?: number; expectedPeople?: number; guests?: { id: string; name: string; addedBy: string }[] } = {}) => ({
	totalCents: over.totalCents ?? 250000,
	expectedPeople: over.expectedPeople,
	participants: uids.map((uid) => ({ uid, joinedAt: AT })),
	guests: over.guests ?? [],
	responses: resp.map(([who, going, limitCents]) => ({ who, going, ...(limitCents ? { limitCents } : {}), by: who, at: AT })),
});

describe("sharePreview", () => {
	it("com pessoas previstas: total ÷ previstas", () => {
		expect(sharePreview(mk(["a", "b"], [], { expectedPeople: 10 }), "a")).toEqual({ cents: 25000, basis: "expected", people: 10 });
	});
	it("usa a mesma divisão da conta (maior parte)", () => {
		expect(sharePreview(mk(["a"], [], { expectedPeople: 9 }), "a")).toEqual({ cents: 27778, basis: "expected", people: 9 });
	});
	it("se já há mais gente no plano do que o previsto, usa as pessoas reais", () => {
		const p = sharePreview(mk(["a", "b", "c", "d"], [], { expectedPeople: 2, totalCents: 100000 }), "a");
		expect(p).toEqual({ cents: 25000, basis: "expected", people: 4 });
	});
	it("sem previsão e ninguém mais disse Vou: total ÷ pessoas do plano (base própria, não é a parte de hoje)", () => {
		expect(sharePreview(mk(["a", "b", "c", "d", "e"], []), "a")).toEqual({ cents: 50000, basis: "plan", people: 5 });
		expect(sharePreview(mk(["a"], []), "a")).toEqual({ cents: 250000, basis: "plan", people: 1 });
	});
	it("sem previsão: a parte de hoje se esta pessoa for", () => {
		// b e c vão (sem limite); a entra: 3 pessoas
		expect(sharePreview(mk(["a", "b", "c", "d"], [["b", true], ["c", true]], { totalCents: 90000 }), "a")).toEqual({ cents: 30000, basis: "today", people: 3 });
	});
	it("quem já respondeu Vou conta uma vez só (a resposta dela não pesa na própria prévia)", () => {
		const p = sharePreview(mk(["a", "b"], [["a", true, 100], ["b", true]], { totalCents: 90000 }), "a");
		expect(p).toEqual({ cents: 45000, basis: "today", people: 2 });
	});
	it("limites de terceiros só entram na conta; o resultado é só o valor da parte", () => {
		// b tem limite 100 (R$ 1,00): com a, as 2 pessoas pagariam 450 > 1,00, então b fica fora e a paga o total
		const p = sharePreview(mk(["a", "b"], [["b", true, 100]], { totalCents: 90000 }), "a");
		expect(p).toEqual({ cents: 90000, basis: "today", people: 1 });
		expect(Object.keys(p!).sort()).toEqual(["basis", "cents", "people"]);
	});
	it("pessoa sem celular conta como pessoa do plano", () => {
		const p = sharePreview(mk(["a", "b"], [], { totalCents: 90000, guests: [{ id: "pg_1", name: "G", addedBy: "a" }] }), "pg_1");
		expect(p).toEqual({ cents: 30000, basis: "plan", people: 3 });
	});
	it("valor menor que o número de pessoas: sem prévia", () => {
		expect(sharePreview(mk(["a"], [], { totalCents: 3, expectedPeople: 10 }), "a")).toBeNull();
	});
});
