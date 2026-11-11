import { formatBRL } from "@/lib/money";
import { buildInstallmentShareText } from "./due-dates";

/** Endereço da página da despesa, para mandar ao grupo. */
export function buildExpenseLink(origin: string, groupId: string, expenseId: string): string {
	return `${origin.replace(/\/+$/, "")}/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(expenseId)}`;
}

/**
 * Mensagem para avisar o grupo de uma despesa nova.
 * Compra parcelada (`installment`): "Paguei uma nova despesa de 6 parcelas de R$ X, ..."; `amountCents` é o valor de cada parcela.
 */
export function buildExpenseShareText(
	e: { amountCents: number; description: string; installment?: { count: number } | null },
	link: string,
): string {
	if (e.installment && e.installment.count > 1) {
		return buildInstallmentShareText({ amountCents: e.amountCents, description: e.description, installmentCount: e.installment.count }, link);
	}
	const description = e.description.trim().replace(/[\s.]+$/, "");
	return `Paguei uma nova despesa de ${formatBRL(e.amountCents)}, referente a ${description}. Abra o link e pague sua parte. ${link}`;
}

/** Frase de abertura do sheet de avisar o grupo; depois de lançar uma compra parcelada, diz quantas parcelas foram lançadas. */
export function shareIntro(kind: "launched" | "manual", installmentCount?: number | null): string {
	if (kind === "manual") return "Mande o link para cada um pagar a sua parte.";
	return installmentCount && installmentCount > 1
		? `${installmentCount} parcelas lançadas, uma por mês. Avise o grupo para cada um pagar a sua parte.`
		: "Avise o grupo para cada um pagar a sua parte.";
}
