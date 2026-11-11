import { describe, expect, it } from "vitest";
import { buildExpenseLink, buildExpenseShareText, shareIntro } from "./expense-share";

describe("buildExpenseLink", () => {
	it("monta o endereço da despesa", () => {
		expect(buildExpenseLink("https://x.app/", "g1", "e 2")).toBe("https://x.app/app/grupos/g1/despesas/e%202");
	});
});

describe("buildExpenseShareText", () => {
	const link = "https://x.app/app/grupos/g/despesas/e";
	it("usa a frase combinada", () => {
		expect(buildExpenseShareText({ amountCents: 28990, description: "Remédios da farmácia" }, link)).toBe(
			`Paguei uma nova despesa de R$ 289,90, referente a Remédios da farmácia. Abra o link e pague sua parte. ${link}`,
		);
	});
	it("apara a descrição e não duplica o ponto final", () => {
		expect(buildExpenseShareText({ amountCents: 1000, description: "  Gás.  " }, link)).toContain("referente a Gás. Abra");
		expect(buildExpenseShareText({ amountCents: 1000, description: "Gás..." }, link)).toContain("referente a Gás. Abra");
	});
	it("variante de compra parcelada", () => {
		expect(buildExpenseShareText({ amountCents: 12000, description: "Geladeira nova.", installment: { count: 6 } }, link)).toBe(
			`Paguei uma nova despesa de 6 parcelas de R$ 120,00, referente a Geladeira nova. Abra o link e pague sua parte. ${link}`,
		);
	});
	it("parcelamento nulo usa a frase comum", () => {
		expect(buildExpenseShareText({ amountCents: 1000, description: "Gás", installment: null }, link)).toContain("despesa de R$ 10,00");
	});
});

describe("shareIntro", () => {
	it("compra comum", () => expect(shareIntro("launched")).toBe("Avise o grupo para cada um pagar a sua parte."));
	it("compra parcelada", () => expect(shareIntro("launched", 6)).toBe("6 parcelas lançadas, uma por mês. Avise o grupo para cada um pagar a sua parte."));
	it("manual", () => expect(shareIntro("manual", 6)).toBe("Mande o link para cada um pagar a sua parte."));
});
