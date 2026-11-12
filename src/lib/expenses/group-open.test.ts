import { describe, expect, it } from "vitest";
import { buildOpenLists, MAX_PEOPLE_PER_EXPENSE, type OpenSource } from "./group-open";

const TODAY = "2026-11-12";
const name = (u: string) => ({ a: "Ana", b: "Bruno", c: "Carla", d: "Dora" })[u] ?? u;
const caps = { maxExpenses: 40, maxUpcoming: 30 };
const S = (uid: string, amountCents: number, paidCents = 0) => ({ uid, amountCents, paidCents });
const src = (over: Partial<OpenSource> = {}): OpenSource => ({
	_id: "1",
	paidBy: "a",
	description: "Mercado",
	amountCents: 3000,
	date: "2026-11-01",
	dueDate: null,
	shares: [S("a", 1000), S("b", 1000), S("c", 1000)],
	...over,
});
const run = (list: OpenSource[]) => buildOpenLists(list, TODAY, name, caps);

describe("buildOpenLists: despesas em aberto", () => {
	it("pagamento parcial mostra o que FALTA; quitada e valor zero nunca aparecem", () => {
		const r = run([src({ shares: [S("a", 1000), S("b", 1000, 400), S("c", 1000, 1000), S("d", 0)] })]);
		expect(r.expenses).toHaveLength(1);
		expect(r.expenses[0].owes).toEqual([{ name: "Bruno", cents: 600 }]);
		expect(r.expenses[0].refunds).toEqual([]);
		expect(run([src({ shares: [S("a", 1000), S("b", 1000, 1000)] })]).expenseCount).toBe(0);
	});
	it("devolução aparece em linha própria (quem recebe de volta e quanto)", () => {
		const r = run([src({ shares: [S("a", 1000), S("b", 500, 1000)] })]);
		expect(r.expenses[0]).toMatchObject({ owes: [], refunds: [{ name: "Bruno", cents: 500 }] });
		expect(r.upcomingCount).toBe(0);
	});
	it("ordem: atrasadas (mais antiga primeiro), depois por vencimento, depois sem data da mais recente", () => {
		const r = run([
			src({ _id: "1", description: "sem data antiga", date: "2026-10-01" }),
			src({ _id: "2", description: "vence 20", dueDate: "2026-11-20" }),
			src({ _id: "3", description: "atrasada 10", dueDate: "2026-11-10" }),
			src({ _id: "4", description: "sem data nova", date: "2026-11-09" }),
			src({ _id: "5", description: "atrasada 05", dueDate: "2026-11-05" }),
			src({ _id: "6", description: "vence 15", dueDate: "2026-11-15" }),
		]);
		expect(r.expenses.map((e) => e.description)).toEqual(["atrasada 05", "atrasada 10", "vence 15", "vence 20", "sem data nova", "sem data antiga"]);
	});
	it("vencimento só aparece quando importa: atrasado ou nos próximos 15 dias", () => {
		const r = run([src({ _id: "1", description: "longe", dueDate: "2026-12-20" }), src({ _id: "2", description: "perto", dueDate: "2026-11-27" }), src({ _id: "3", description: "atrasada", dueDate: "2026-11-11" })]);
		const by = Object.fromEntries(r.expenses.map((e) => [e.description, e]));
		expect(by.longe).toMatchObject({ dueDate: null, overdue: false });
		expect(by.perto).toMatchObject({ dueDate: "2026-11-27", overdue: false });
		expect(by.atrasada).toMatchObject({ dueDate: "2026-11-11", overdue: true });
	});
	it("parcelas e despesas fixas: cada uma é uma linha, com o rótulo na descrição", () => {
		const r = run([src({ _id: "1", description: "Notebook", installment: { number: 2, count: 6 }, dueDate: "2026-11-20" }), src({ _id: "2", description: "Aluguel", recurrence: { id: "r", period: "2026-11" } })]);
		expect(r.expenses.map((e) => e.description).sort()).toEqual(["Aluguel (despesa fixa)", "Notebook (parcela 2 de 6)"]);
	});
	it("corta pessoas por despesa e despesas pelo limite, mantendo as contagens", () => {
		const shares = [S("a", 100), ...Array.from({ length: 12 }, (_, i) => S(`p${i}`, 100))];
		const r = buildOpenLists([src({ _id: "9", shares }), src({ _id: "2" }), src({ _id: "3" })], TODAY, name, { maxExpenses: 2, maxUpcoming: 1 });
		expect(r.expenses).toHaveLength(2);
		expect(r.expenseCount).toBe(3);
		const big = r.expenses.find((e) => e.owes.length === MAX_PEOPLE_PER_EXPENSE)!;
		expect(big.moreOwes).toBe(12 - MAX_PEOPLE_PER_EXPENSE);
	});
	it("soma de tudo o que a seção mostra = soma das dívidas (sem nada cortado)", () => {
		const list = [src({ shares: [S("a", 1000), S("b", 1000, 400), S("c", 500, 900)] }), src({ _id: "2", paidBy: "b", shares: [S("b", 100), S("a", 700)] })];
		const r = run(list);
		const shown = r.expenses.flatMap((e) => [...e.owes, ...e.refunds]).reduce((t, p) => t + p.cents, 0);
		expect(shown).toBe(600 + 400 + 700);
	});
});

describe("buildOpenLists: próximos 15 dias", () => {
	const at = (dueDate: string | null, id: string) => src({ _id: id, description: `D${id}`, dueDate });
	it("fronteiras: ontem fora, hoje e hoje+15 dentro, hoje+16 fora; sem data fora", () => {
		const r = run([at("2026-11-11", "1"), at("2026-11-12", "2"), at("2026-11-27", "3"), at("2026-11-28", "4"), at(null, "5")]);
		expect(r.upcoming.map((u) => u.description)).toEqual(["D2", "D3"]);
		expect(r.upcomingCount).toBe(2);
	});
	it("ordem por vencimento e subtotal = soma do que falta", () => {
		const r = run([at("2026-11-20", "1"), at("2026-11-13", "2"), src({ _id: "3", description: "D3", dueDate: "2026-11-13", shares: [S("a", 1000), S("b", 1000, 250)] })]);
		expect(r.upcoming.map((u) => [u.dueDate, u.description])).toEqual([["2026-11-13", "D2"], ["2026-11-13", "D3"], ["2026-11-20", "D1"]]);
		expect(r.upcomingTotalCents).toBe(2000 + 750 + 2000);
		expect(r.upcoming[0]).toMatchObject({ paidByName: "Ana", owes: [{ name: "Bruno", cents: 1000 }, { name: "Carla", cents: 1000 }] });
	});
	it("devolução não tem vencimento: fora dos próximos 15 dias; vazio = nada", () => {
		const r = run([src({ dueDate: "2026-11-15", shares: [S("a", 1000), S("b", 500, 1000)] })]);
		expect(r.upcoming).toEqual([]);
		expect(r.upcomingTotalCents).toBe(0);
	});
	it("mês de despesa fixa que só existe como modelo entra no período, rotulado, mas não nas despesas em aberto", () => {
		const r = run([src({ _id: "t", description: "Aluguel", dueDate: "2026-11-25", fromTemplate: true })]);
		expect(r.upcoming).toMatchObject([{ description: "Aluguel (despesa fixa)", dueDate: "2026-11-25" }]);
		expect(r.expenses).toEqual([]);
	});
	it("o corte de maxUpcoming mantém contagem e subtotal de tudo", () => {
		const r = buildOpenLists([at("2026-11-13", "1"), at("2026-11-14", "2"), at("2026-11-15", "3")], TODAY, name, { maxExpenses: 40, maxUpcoming: 1 });
		expect(r.upcoming).toHaveLength(1);
		expect(r.upcomingCount).toBe(3);
		expect(r.upcomingTotalCents).toBe(6000);
	});
});
