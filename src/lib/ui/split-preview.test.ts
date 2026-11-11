import { describe, expect, it } from "vitest";
import { installmentSplitLine, monthlySplitLine, splitPreview } from "./split-preview";

describe("splitPreview", () => {
	it("vazio sem valor ou sem gente", () => {
	  expect(splitPreview(0, ["a", "b"], "a")).toEqual({ kind: "empty" });
	  expect(splitPreview(1000, [], "a")).toEqual({ kind: "empty" });
	});
	it("divisão exata", () => {
	  const r = splitPreview(10000, ["a", "b", "c", "d"], "a");
	  expect(r).toEqual({ kind: "ok", line: "Fica R$ 25,00 para cada um", note: null, othersCents: 7500, baseCents: 2500, people: 4 });
	});
	it("sobra fica com quem pagou", () => {
	  const r = splitPreview(1000, ["a", "b", "c"], "a");
	  expect(r).toMatchObject({ kind: "ok", line: "Fica R$ 3,33 para cada um", note: "Você fica com 1 centavo a mais", othersCents: 666 });
	});
	it("sobra de vários centavos", () => {
	  const r = splitPreview(1002, ["a", "b", "c", "d"], "a");
	  expect(r).toMatchObject({ note: "Você fica com 2 centavos a mais" });
	});
	it("quem pagou fora da divisão: centavos vão para os primeiros", () => {
	  const r = splitPreview(1000, ["b", "c", "d"], "a");
	  expect(r).toMatchObject({ kind: "ok", note: "Uma pessoa fica com 1 centavo a mais", othersCents: 1000 });
	  expect(splitPreview(1001, ["b", "c", "d"], "a")).toMatchObject({ note: "2 pessoas ficam com 1 centavo a mais" });
	});
	it("quem pagou é uma pessoa sem celular: usa o nome dela", () => {
	  expect(splitPreview(1000, ["b", "c", "d"], "b", "Benjamim")).toMatchObject({ note: "Benjamim fica com 1 centavo a mais" });
	});
	it("valor pequeno demais", () => {
	  expect(splitPreview(2, ["a", "b", "c"], "a").kind).toBe("error");
	});
});

describe("installmentSplitLine", () => {
	it("por pessoa em cada parcela", () => {
		expect(installmentSplitLine({ baseCents: 3000, people: 4 })).toBe("Fica R$ 30,00 por pessoa em cada parcela");
		expect(installmentSplitLine({ baseCents: 3000, people: 1 })).toBe("Fica R$ 30,00 para a pessoa escolhida em cada parcela");
	});
});

describe("monthlySplitLine", () => {
	it("por pessoa ou para a pessoa escolhida", () => {
		expect(monthlySplitLine({ baseCents: 30000, people: 4 })).toBe("Fica R$ 300,00 por pessoa em cada mês");
		expect(monthlySplitLine({ baseCents: 30000, people: 1 })).toBe("Fica R$ 300,00 para a pessoa escolhida em cada mês");
	});
});
