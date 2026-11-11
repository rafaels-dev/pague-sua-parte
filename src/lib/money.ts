const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Formata centavos inteiros como moeda pt-BR, ex.: 123456 -> "R$ 1.234,56". */
export function formatBRL(cents: number): string {
	// Intl usa espaço não separável (U+00A0) após "R$"; normalizamos para espaço comum.
	return brl.format(cents / 100).replace(/ /g, " ");
}

/**
 * Converte texto pt-BR ("1.234,56", "R$ 10", "0,5") em centavos inteiros.
 * Retorna null se inválido (inclui negativos); 0 é válido.
 */
export function parseBRLToCents(input: string): number | null {
	const s = input.replace(/R\$/gi, "").replace(/\s/g, "");
	if (!s) return null;
	// inteiro com milhares opcionais (1.234 ou 1234), decimais opcionais com até 2 dígitos
	const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
	if (!m) return null;
	const reais = Number(m[1].replace(/\./g, ""));
	const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
	const total = reais * 100 + cents;
	return Number.isSafeInteger(total) ? total : null;
}
