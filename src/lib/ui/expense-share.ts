import { formatBRL } from "@/lib/money";

/** Endereço da página da despesa, para mandar ao grupo. */
export function buildExpenseLink(origin: string, groupId: string, expenseId: string): string {
	return `${origin.replace(/\/+$/, "")}/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(expenseId)}`;
}

/** Mensagem para avisar o grupo de uma despesa nova. */
export function buildExpenseShareText(e: { amountCents: number; description: string }, link: string): string {
	const description = e.description.trim().replace(/[\s.]+$/, "");
	return `Paguei uma nova despesa de ${formatBRL(e.amountCents)}, referente a ${description}. Abra o link e pague sua parte. ${link}`;
}
