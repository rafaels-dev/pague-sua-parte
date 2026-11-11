import { formatBRL } from "@/lib/money";

/** Até R$ 99.999.999,99 (10 dígitos): o servidor aceita menos que isso, mas a máscara não deve estourar. */
const MAX_DIGITS = 10;

/**
 * Máscara de dinheiro "digitou, preenche os centavos": "1234" -> 1234 centavos (R$ 12,34).
 * Aceita o texto inteiro do campo (com "R$", pontos e vírgula) e ignora tudo que não é dígito.
 * Dígitos além do limite (o último digitado) são descartados.
 */
export function centsFromTyped(text: string): number {
	const digits = text.replace(/\D/g, "").slice(0, MAX_DIGITS);
	return digits ? Number(digits) : 0;
}

/** Texto do campo: vazio para zero (assim aparece o texto de exemplo), senão "R$ 12,34". */
export function maskedMoney(cents: number): string {
	return cents > 0 ? formatBRL(cents) : "";
}
