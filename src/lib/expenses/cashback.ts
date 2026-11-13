/** Como o cashback de uma compra parcelada entra nas parcelas. */
export type CashbackMode = "spread" | "first";

export const CASHBACK_MODES: readonly CashbackMode[] = ["spread", "first"];

export const CASHBACK_TOO_BIG = "O cashback precisa ser menor que o valor da compra.";
export const CASHBACK_TOO_BIG_FIRST = "O cashback é maior que a primeira parcela. Escolha dividir entre as parcelas.";

export type CashbackSplit = { ok: true; perInstallment: number[] } | { ok: false; error: string };

/**
 * Cashback de cada parcela, em centavos inteiros (a soma é exatamente `cashbackCents`).
 * `spread`: `floor(C/N)` em cada uma e o resto, 1 centavo por parcela, para as primeiras.
 * `first`: tudo na primeira; as outras ficam em 0.
 * `grossCents` é o valor bruto de CADA parcela. Cada parcela precisa continuar com valor líquido > 0.
 * Sem parcelas (`count` = 1), o modo não importa.
 */
export function splitCashback(grossCents: number, count: number, cashbackCents: number, mode: CashbackMode = "spread"): CashbackSplit {
	if (!Number.isInteger(cashbackCents) || cashbackCents <= 0) return { ok: false, error: "Informe um cashback válido." };
	if (!Number.isInteger(count) || count < 1) throw new Error("Número de parcelas inválido");
	const per: number[] = new Array(count).fill(0);
	if (count === 1 || mode === "first") {
		per[0] = cashbackCents;
	} else {
		const base = Math.floor(cashbackCents / count);
		const rest = cashbackCents - base * count;
		for (let i = 0; i < count; i++) per[i] = base + (i < rest ? 1 : 0);
	}
	if (per.some((c) => c >= grossCents)) {
		return { ok: false, error: count > 1 && mode === "first" ? CASHBACK_TOO_BIG_FIRST : CASHBACK_TOO_BIG };
	}
	return { ok: true, perInstallment: per };
}

export type NetSplit = { ok: true; cashbacks: number[]; nets: number[] } | { ok: false; error: string };

/**
 * Única conta do que se divide em cada parcela (bruto menos o cashback dela), usada pelo servidor e pela prévia da tela.
 * Só pode haver DOIS valores diferentes: `spread` dá `base+1` às primeiras e `base` às demais; `first` dá tudo à primeira.
 * Em ambos o cashback não aumenta ao longo das parcelas, então a primeira parcela tem o menor líquido e a última, o maior.
 */
export function netPerInstallment(grossCents: number, count: number, cashbackCents: number, mode: CashbackMode = "spread"): NetSplit {
	const r = splitCashback(grossCents, count, cashbackCents, mode);
	if (!r.ok) return r;
	return { ok: true, cashbacks: r.perInstallment, nets: r.perInstallment.map((c) => grossCents - c) };
}
