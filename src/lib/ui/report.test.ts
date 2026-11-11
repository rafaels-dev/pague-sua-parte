import { describe, expect, it } from "vitest";
import {
	barPercent,
	barScale,
	currentMonthPeriod,
	fairnessWords,
	markerPercent,
	monthShort,
	normalizeReport,
	percentText,
	periodFor,
	periodKind,
	periodLabel,
	personCaption,
	personFacts,
	shiftMonth,
	stepMonthPeriod,
} from "./report";

describe("períodos", () => {
	it("monta o período a partir de hoje", () => {
		expect(periodFor("all", "2026-11-11")).toBe("all");
		expect(periodFor("month", "2026-11-11")).toBe("month:2026-11");
		expect(periodFor("year", "2026-11-11")).toBe("year:2026");
		expect(currentMonthPeriod("2026-01-31")).toBe("month:2026-01");
	});
	it("tipo do período", () => {
		expect(periodKind("all")).toBe("all");
		expect(periodKind("month:2026-01")).toBe("month");
		expect(periodKind("year:2026")).toBe("year");
	});
	it("soma meses atravessando o ano", () => {
		expect(shiftMonth("2026-01", -1)).toBe("2025-12");
		expect(shiftMonth("2025-12", 1)).toBe("2026-01");
		expect(shiftMonth("2026-03", -14)).toBe("2025-01");
		expect(shiftMonth("lixo", 1)).toBe("lixo");
	});
	it("setas: o mês seguinte nunca passa de hoje", () => {
		expect(stepMonthPeriod("month:2026-11", 1, "2026-11-11")).toBeNull();
		expect(stepMonthPeriod("month:2026-10", 1, "2026-11-11")).toBe("month:2026-11");
		expect(stepMonthPeriod("month:2026-01", -1, "2026-11-11")).toBe("month:2025-12");
		expect(stepMonthPeriod("all", -1, "2026-11-11")).toBeNull();
	});
	it("rótulos", () => {
		expect(periodLabel("all")).toBe("Todo o período");
		expect(periodLabel("month:2026-03")).toBe("Março de 2026");
		expect(periodLabel("year:2026")).toBe("Ano de 2026");
		expect(monthShort("2026-03", "2026-11-11")).toBe("mar");
		expect(monthShort("2025-12", "2026-11-11")).toBe("dez 25");
	});
});

describe("equilíbrio", () => {
	it("palavras por faixa", () => {
		expect(fairnessWords(100).label).toBe("Bem dividido");
		expect(fairnessWords(85).label).toBe("Bem dividido");
		expect(fairnessWords(84).label).toBe("Dá para equilibrar melhor");
		expect(fairnessWords(60).label).toBe("Dá para equilibrar melhor");
		expect(fairnessWords(59).label).toBe("Poucas pessoas estão carregando a maior parte");
		expect(fairnessWords(0).tone).toBe("low");
	});
});

describe("barras", () => {
	const people = [{ bornCents: 80000 }, { bornCents: 20000 }, { bornCents: 0 }];
	it("escala única", () => {
		expect(barScale(people, 33333)).toBe(80000);
		expect(barScale([], 0)).toBe(0);
		expect(barScale([{ bornCents: 100 }], 500)).toBe(500);
	});
	it("larguras e marca na mesma escala", () => {
		expect(barPercent(80000, 80000)).toBe(100);
		expect(barPercent(20000, 80000)).toBe(25);
		expect(barPercent(0, 80000)).toBe(0);
		expect(barPercent(10, 80000)).toBe(2);
		expect(barPercent(5, 0)).toBe(0);
		expect(markerPercent(40000, 80000)).toBe(50);
		expect(markerPercent(10, 0)).toBe(0);
	});
	it("texto da porcentagem", () => {
		expect(percentText(4000)).toBe("40%");
		expect(percentText(0)).toBe("0%");
		expect(percentText(30)).toBe("menos de 1%");
		expect(percentText(3333)).toBe("33%");
	});
});

describe("pessoa", () => {
	const base = normalizeReport({ people: [{ uid: "a", name: "A", bornCents: 100 }], totalCents: 100 })!.people[0];
	it("legendas", () => {
		expect(personCaption(base)).toBeNull();
		expect(personCaption({ kind: "managed", stillMember: true })).toBe("sem celular");
		expect(personCaption({ kind: "user", stillMember: false })).toBe("saiu do grupo");
		expect(personCaption({ kind: "managed", stillMember: false })).toBe("sem celular · saiu do grupo");
	});
	it("fatos só quando não são zero", () => {
		expect(personFacts(base)).toEqual([]);
		expect(personFacts({ ...base, advancedCents: 5000, expensesPaidCount: 1, pendingCents: 2500, helpedCount: 2 })).toEqual([
			"Adiantou R$ 50,00 em 1 despesa",
			"Ainda vai pagar R$ 25,00",
			"Ajudou em 2 despesas",
		]);
	});
});

describe("normalizeReport", () => {
	it("formato desconhecido vira null", () => {
		expect(normalizeReport(null)).toBeNull();
		expect(normalizeReport({ error: "x" })).toBeNull();
	});
	it("completa o que falta e ordena", () => {
		const r = normalizeReport({
			totalCents: 1000,
			people: [{ uid: "b", name: "B", bornCents: 100 }, { uid: "a", name: "A", bornCents: 900, bornPercent: 9000, kind: "managed", stillMember: false }],
			months: [{ month: "2026-02", totalCents: 1 }, { month: "2026-01", totalCents: 2 }, { month: "x" }],
		})!;
		expect(r.people.map((p) => p.uid)).toEqual(["a", "b"]);
		expect(r.people[0]).toMatchObject({ kind: "managed", stillMember: false, bornPercent: 9000 });
		expect(r.people[1]).toMatchObject({ kind: "user", stillMember: true, helpedCount: 0 });
		expect(r.months.map((m) => m.month)).toEqual(["2026-01", "2026-02"]);
		expect(r.expenseCount).toBe(0);
		expect(r.fairnessPercent).toBe(0);
	});
});
