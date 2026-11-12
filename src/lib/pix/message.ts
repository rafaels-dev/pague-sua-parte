/** Mensagens que o app do banco mostra no Pix (só texto simples; `buildPixPayload` ainda faz o corte final). */
import { sanitizeDescription } from "./brcode";

type Installment = { number: number; count: number } | null | undefined;

/** Menor título que vale a pena manter ao encaixar o sufixo de parcela. */
const MIN_TITLE = 6;

/**
 * "<prefixo> <título> parcela N de M". Se não couber em `budget`, mantém a parcela e corta o título; só larga a parcela
 * quando nem um título de ~6 letras mais a parcela cabem.
 */
function compose(prefix: string, title: string, installment: Installment, budget = Number.POSITIVE_INFINITY): string {
	const base = sanitizeDescription(`${prefix} ${title}`, 1000) || prefix;
	if (!installment) return base;
	const suffix = ` parcela ${installment.number} de ${installment.count}`;
	if (base.length + suffix.length <= budget) return base + suffix;
	const room = budget - suffix.length;
	const cut = sanitizeDescription(base, room);
	return cut.length >= prefix.length + 1 + MIN_TITLE ? cut + suffix : base;
}

/** "Despesa Mercado do mes" ou, em parcela, "Despesa TV parcela 2 de 6". */
export function shareMessage(description: string, installment?: Installment, budget?: number): string {
	return compose("Despesa", description, installment, budget);
}

/** Devolução de uma despesa. */
export function refundMessage(description: string, installment?: Installment, budget?: number): string {
	return compose("Devolucao", description, installment, budget);
}

/** "Pagar tudo": a própria despesa quando é uma só; senão "PagueSuaParte N contas". */
export function batchMessage(items: readonly { description: string; kind?: string; installment?: Installment }[], budget?: number): string {
	if (items.length === 1) {
		const i = items[0];
		return i.kind === "refund" ? refundMessage(i.description, i.installment, budget) : shareMessage(i.description, i.installment, budget);
	}
	return `PagueSuaParte ${items.length} contas`;
}
