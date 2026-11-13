import { formatBRL } from "@/lib/money";

/** O que o resumo de uma despesa precisa saber de cada pessoa (um pedaço de `ExpenseDetailData`). */
type SummaryShare = {
	name: string;
	status: "payer" | "pending" | "paid" | "refund";
	amountCents: number;
	paidCents: number;
	dueCents: number;
	refundCents: number;
	participates: boolean;
	refund?: { cents: number } | null;
};
export type SummaryExpense = {
	description: string;
	amountCents: number;
	paidBy: { name: string };
	overdue: boolean;
	dueDate?: string | null;
	installment?: { number: number; count: number } | null;
	shares: SummaryShare[];
};

const cleanDescription = (d: string) => d.trim().replace(/[\s.]+$/, "");

/** Situação de uma pessoa, em palavras curtas. */
export function shareStatusLine(s: SummaryShare, overdue: boolean): string {
	if (s.status === "payer") return `${formatBRL(s.amountCents)} (pagou a conta)`;
	if (s.status === "refund" && !s.participates) return `saiu da divisão (a receber de volta ${formatBRL(s.refundCents)})`;
	if (s.status === "refund") return `${formatBRL(s.amountCents)} (paga; a receber de volta ${formatBRL(s.refundCents)})`;
	if (s.status === "pending") {
		if (s.paidCents > 0) return `${formatBRL(s.amountCents)} (pago parcialmente${overdue ? ", atrasado" : ""}; já pagou ${formatBRL(s.paidCents)}, falta ${formatBRL(s.dueCents)})`;
		return `${formatBRL(s.amountCents)} (pendente${overdue ? ", atrasado" : ""})`;
	}
	if (!s.participates) return s.refund ? `saiu da divisão (devolvido ${formatBRL(s.refund.cents)})` : "saiu da divisão";
	return `${formatBRL(s.amountCents)} (pago${s.refund ? `; devolvido ${formatBRL(s.refund.cents)}` : ""})`;
}

/**
 * Resumo da situação de UMA despesa para o WhatsApp: descrição, total, quem pagou, a parte de cada um (paga, pendente,
 * a receber de volta) e o link. Igual para quem compartilhar. Parcelada: o valor é o da parcela.
 */
export function buildExpenseStatusText(e: SummaryExpense, link: string): string {
	const parcela = e.installment ? ` (parcela ${e.installment.number} de ${e.installment.count})` : "";
	const lines = [`*${cleanDescription(e.description)}*${parcela}`, `Total: ${formatBRL(e.amountCents)}`, `Pago por ${e.paidBy.name}`, ""];
	// Quem saiu da divisão sem nada a acertar não aparece; só entra quem tem devolução (feita ou a fazer).
	for (const s of e.shares.filter((x) => x.participates || x.status === "refund" || x.refund)) lines.push(`${s.name}: ${shareStatusLine(s, e.overdue)}`);
	lines.push("", `Veja os detalhes: ${link}`);
	return lines.join("\n");
}

/** Frase de abertura do sheet "Compartilhar resumo" de uma despesa. */
export function expenseSummaryIntro(): string {
	return "Mande para o grupo ver como está esta despesa: quem já pagou e quem falta.";
}

/**
 * Aviso de quem acabou de devolver o que a pessoa pagou a mais: o link leva à despesa, onde ela vê a devolução e o comprovante.
 * `toName`: para quem foi a devolução.
 */
export function buildRefundShareText(p: { amountCents: number; description: string; toName: string; hasReceipt: boolean }, link: string): string {
	const see = p.hasReceipt ? "Veja o comprovante:" : "Confira aqui:";
	return `Devolvi ${formatBRL(p.amountCents)} para ${p.toName}, da despesa ${cleanDescription(p.description)}. ${see} ${link}`;
}
