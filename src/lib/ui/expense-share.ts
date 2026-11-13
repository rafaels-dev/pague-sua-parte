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
	e: { amountCents: number; description: string; installment?: { count: number } | null; /** As parcelas têm valores diferentes (cashback): o texto não promete um valor igual. */ installmentsDiffer?: boolean },
	link: string,
): string {
	if (e.installment && e.installment.count > 1) {
		return buildInstallmentShareText({ amountCents: e.amountCents, description: e.description, installmentCount: e.installment.count, withoutValue: e.installmentsDiffer }, link);
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

/**
 * Mensagem de quem acabou de pagar a sua parte: o link leva à despesa, onde quem recebe vê o pagamento e o comprovante.
 * `forName`: nome da pessoa sem celular, quando o responsável pagou por ela.
 */
export function buildPaidShareText(
	p: { amountCents: number; description: string; forName?: string | null; hasReceipt: boolean; /** Pagamento parcial: o que ainda falta da parte. */ remainingCents?: number; /** Quitou o que faltava depois de parciais: `amountCents` é só esse último pagamento. */ afterParts?: boolean },
	link: string,
): string {
	const description = p.description.trim().replace(/[\s.]+$/, "");
	const whose = p.forName ? `a parte de ${p.forName}` : "minha parte";
	const see = p.hasReceipt ? "Veja o comprovante:" : "Confira aqui:";
	if (p.afterParts) {
		return `Paguei o que faltava d${p.forName ? `a parte de ${p.forName}` : "a minha parte"}, ${formatBRL(p.amountCents)}, da despesa ${description}. ${see} ${link}`;
	}
	if (p.remainingCents && p.remainingCents > 0) {
		const ofWhose = p.forName ? `da parte de ${p.forName}` : "da minha parte";
		return `Paguei ${formatBRL(p.amountCents)} ${ofWhose} (faltam ${formatBRL(p.remainingCents)}), da despesa ${description}. ${see} ${link}`;
	}
	return `Paguei ${whose}, ${formatBRL(p.amountCents)}, da despesa ${description}. ${see} ${link}`;
}
