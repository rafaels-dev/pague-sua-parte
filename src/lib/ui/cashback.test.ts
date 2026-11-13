import { describe, expect, it } from "vitest";
import { cashbackDetailLine, cashbackDivideLine, cashbackEditNote, cashbackForSubmit, cashbackFormProblems, cashbackPlan, differingInstallmentTexts } from "./cashback";

const norm = (s: string) => s.replace(/ /g, " ");

describe("cashbackDetailLine / cashbackEditNote", () => {
	it("mostra o que custou e o cashback", () => {
		expect(norm(cashbackDetailLine(95_000, 5_000))).toBe("Custou R$ 1.000,00 · cashback R$ 50,00");
		expect(norm(cashbackDetailLine(95_000, 5_000, true))).toBe("Esta parcela custou R$ 1.000,00 · cashback R$ 50,00");
	});
	it("avisa na edição que o valor já está descontado", () => {
		expect(norm(cashbackEditNote(5_000))).toContain("já está com o cashback descontado");
	});
});

describe("cashbackPlan", () => {
	it("à vista", () => {
		const p = cashbackPlan(100_000, 1, 5_000, "spread");
		expect(p).toEqual({ ok: true, nets: [95_000], grossTotalCents: 100_000, netTotalCents: 95_000 });
		if (p.ok) expect(norm(cashbackDivideLine(p))).toBe("Fica R$ 950,00 para dividir (R$ 1.000,00 menos R$ 50,00 de cashback).");
	});
	it("parcelado: a soma líquida é o bruto menos o cashback", () => {
		const p = cashbackPlan(10_000, 3, 1_000, "spread");
		expect(p.ok && p.nets).toEqual([9_666, 9_667, 9_667]);
		expect(p.ok && p.netTotalCents).toBe(29_000);
	});
	it("devolve o erro do servidor quando não cabe", () => {
		expect(cashbackPlan(10_000, 3, 10_000, "first")).toEqual({ ok: false, error: "O cashback é maior que a primeira parcela. Escolha dividir entre as parcelas." });
	});
	it("sem valor ainda: sem erro escrito", () => {
		expect(cashbackPlan(0, 1, 100, "spread")).toEqual({ ok: false, error: "" });
	});
});

describe("differingInstallmentTexts", () => {
	const people = ["a", "b"];
	it("parcelas iguais: null", () => {
		expect(differingInstallmentTexts([5_000, 5_000], "spread", people, "a")).toBeNull();
	});
	it("só na primeira: diz que a primeira fica menor", () => {
		const t = differingInstallmentTexts([8_000, 10_000, 10_000], "first", people, "a");
		expect(norm(t!.line)).toBe("Fica R$ 40,00 por pessoa na 1ª parcela e R$ 50,00 nas outras");
		expect(norm(t!.othersChunk)).toBe("R$ 40,00 na 1ª parcela e R$ 50,00 nas outras");
	});
	it("resto de centavos: não promete valor idêntico", () => {
		const t = differingInstallmentTexts([9_666, 9_667, 9_667], "spread", people, "a");
		expect(t!.line).toContain("cerca de");
		expect(t!.othersChunk).toContain("cerca de");
	});
});

describe("cashback em 'todo mês'", () => {
	const form = { amountCents: 1_000, installments: 3, cents: 5_000, mode: "spread" as const, people: 2 };
	it("é ignorado no envio e na validação, mesmo com valor maior que a compra", () => {
		expect(cashbackForSubmit("monthly", 5_000, "spread")).toBeNull();
		expect(cashbackFormProblems({ ...form, payment: "monthly" })).toEqual({});
	});
	it("à vista e parcelado continuam validando; o modo só vai com parcelas", () => {
		expect(cashbackFormProblems({ ...form, payment: "cash" })).toEqual({ cashback: "O cashback precisa ser menor que o valor da compra." });
		expect(cashbackFormProblems({ ...form, payment: "installments", mode: "first" }).cashback).toBe("O cashback é maior que a primeira parcela. Escolha dividir entre as parcelas.");
		expect(cashbackForSubmit("cash", 100, "first")).toEqual({ cents: 100 });
		expect(cashbackForSubmit("installments", 100, "first")).toEqual({ cents: 100, mode: "first" });
		expect(cashbackForSubmit("cash", 0, "spread")).toBeNull();
	});
	it("líquido pequeno demais para tanta gente vira erro em quem divide", () => {
		expect(cashbackFormProblems({ ...form, payment: "cash", amountCents: 10, cents: 8, people: 3 })).toEqual({ participants: "O valor é pequeno demais para dividir entre tantas pessoas." });
	});
});

describe("differingInstallmentTexts: usa a mesma conta do servidor", () => {
	it("a primeira e a última parcela bastam (só há dois valores)", () => {
		const p = cashbackPlan(10_000, 7, 100, "spread");
		expect(p.ok && new Set(p.nets).size).toBe(2);
		if (p.ok) expect(differingInstallmentTexts(p.nets, "spread", ["a", "b"], "a")!.line).toContain("cerca de");
	});
});
