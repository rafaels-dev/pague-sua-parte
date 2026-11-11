import { describe, expect, it } from "vitest";
import { buildExpenseLink, buildExpenseShareText } from "./expense-share";

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
});
