/** Parcelas que ainda existem de uma compra (o que o detalhe sabe), com o valor de cada uma quando conhecido. */
export type SeriesLike = { items: { amountCents?: number }[] };

/**
 * O que o texto de compartilhar pode afirmar de uma compra parcelada: quantas parcelas existem AGORA (alguma pode ter
 * sido apagada) e se dá para falar "N parcelas de R$ X", o que só vale quando as que existem têm o mesmo valor.
 */
export function installmentShareInfo(installment: { count: number }, series: SeriesLike | null): { count: number; sameValue: boolean } {
	const items = series?.items ?? [];
	if (items.length === 0) return { count: installment.count, sameValue: true };
	const values = items.map((i) => i.amountCents).filter((v): v is number => typeof v === "number");
	const differ = values.some((v) => v !== values[0]);
	return { count: items.length, sameValue: !differ };
}
