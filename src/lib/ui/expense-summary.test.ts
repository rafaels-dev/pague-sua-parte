import { describe, expect, it } from "vitest";
import { buildExpenseStatusText, buildRefundShareText, shareStatusLine, type SummaryExpense } from "./expense-summary";

const LINK = "https://pague-sua-parte.app/app/grupos/g1/despesas/e1";
const s = (name: string, status: "payer" | "pending" | "paid" | "refund", amountCents: number, o: Record<string, unknown> = {}) => ({
	name,
	status,
	amountCents,
	paidCents: status === "paid" || status === "payer" ? amountCents : 0,
	dueCents: status === "pending" ? amountCents : 0,
	refundCents: 0,
	participates: true,
	...o,
});
const expense: SummaryExpense = {
	description: "Mercado do mês.",
	amountCents: 62000,
	paidBy: { name: "Maria" },
	overdue: false,
	shares: [
		s("Maria", "payer", 15500),
		s("Rafael", "pending", 15500),
		s("José", "paid", 15500),
		s("Ana Paula", "refund", 15500, { paidCents: 20000, refundCents: 4500 }),
	],
};

describe("buildExpenseStatusText", () => {
	it("descrição, total, quem pagou, a parte de cada um (paga, pendente, a receber de volta) e o link", () => {
		expect(buildExpenseStatusText(expense, LINK)).toBe(
			[
				"*Mercado do mês*",
				"Total: R$ 620,00",
				"Pago por Maria",
				"",
				"Maria: R$ 155,00 (pagou a conta)",
				"Rafael: R$ 155,00 (pendente)",
				"José: R$ 155,00 (pago)",
				"Ana Paula: R$ 155,00 (paga; a receber de volta R$ 45,00)",
				"",
				`Veja os detalhes: ${LINK}`,
			].join("\n"),
		);
	});
	it("atrasado, parcial, parcela, devolvido e quem saiu da divisão", () => {
		expect(shareStatusLine(s("A", "pending", 1000, { paidCents: 400, dueCents: 600 }), true)).toBe("R$ 10,00 (pendente, atrasado; já pagou R$ 4,00, falta R$ 6,00)");
		expect(shareStatusLine(s("A", "paid", 1000, { refund: { cents: 250 } }), false)).toBe("R$ 10,00 (pago; devolvido R$ 2,50)");
		expect(shareStatusLine(s("A", "paid", 0, { participates: false, refund: { cents: 1000 } }), false)).toBe("saiu da divisão (devolvido R$ 10,00)");
		expect(buildExpenseStatusText({ ...expense, installment: { number: 2, count: 6 } }, LINK)).toContain("*Mercado do mês* (parcela 2 de 6)");
	});
	it("quem saiu da divisão sem nada a acertar não aparece; com devolução (feita ou a fazer) aparece de propósito", () => {
		const left = s("Zé", "paid", 0, { participates: false });
		const refunded = s("Ana", "paid", 0, { participates: false, refund: { cents: 1000 } });
		const owed = s("Bia", "refund", 0, { participates: false, paidCents: 700, refundCents: 700 });
		const t = buildExpenseStatusText({ ...expense, shares: [...expense.shares, left, refunded, owed] }, LINK);
		expect(t).not.toContain("Zé");
		expect(t).toContain("Ana: saiu da divisão (devolvido R$ 10,00)");
		expect(t).toContain("Bia: saiu da divisão (a receber de volta R$ 7,00)");
	});
	it("nunca inclui chave Pix", () => {
		const withPix = { ...expense, pix: { key: "segredo@x.com" }, shares: expense.shares.map((x) => ({ ...x, refundPix: { key: "segredo@x.com" } })) };
		expect(buildExpenseStatusText(withPix, LINK)).not.toContain("segredo");
	});
});

describe("buildRefundShareText", () => {
	it("avisa a devolução, com ou sem comprovante", () => {
		expect(buildRefundShareText({ amountCents: 4500, description: "Mercado.", toName: "Ana Paula", hasReceipt: true }, LINK)).toBe(
			`Devolvi R$ 45,00 para Ana Paula, da despesa Mercado. Veja o comprovante: ${LINK}`,
		);
		expect(buildRefundShareText({ amountCents: 4500, description: "Mercado", toName: "Ana", hasReceipt: false }, LINK)).toContain("Confira aqui:");
	});
});
