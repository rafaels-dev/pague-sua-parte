import { formatBRL } from "@/lib/money";
import { splitEqually } from "@/lib/expenses/split";

export type SplitPreview =
	| { kind: "empty" }
	| { kind: "error"; message: string }
	| { kind: "ok"; line: string; note: string | null; othersCents: number; baseCents: number; people: number };

function centavos(n: number): string {
	return n === 1 ? "1 centavo" : `${n} centavos`;
}

/** `payerName`: quando quem pagou é outra pessoa (sem celular que você cuida), o texto usa o nome dela em vez de "Você". */
/** Texto ao vivo de "quanto fica para cada um", com a nota de centavos quando a conta não fecha redonda. */
export function splitPreview(amountCents: number, participantUids: string[], payerUid: string, payerName?: string): SplitPreview {
	if (amountCents <= 0 || participantUids.length === 0) return { kind: "empty" };
	let shares;
	try {
		shares = splitEqually(amountCents, participantUids, payerUid);
	} catch {
		return { kind: "error", message: "O valor é pequeno demais para dividir entre tantas pessoas." };
	}
	const base = Math.min(...shares.map((s) => s.amountCents));
	const extra = shares.filter((s) => s.amountCents > base);
	const othersCents = shares.filter((s) => s.uid !== payerUid).reduce((sum, s) => sum + s.amountCents, 0);
	const line = shares.length === 1 ? `Fica ${formatBRL(base)} para a pessoa escolhida` : `Fica ${formatBRL(base)} para cada um`;

	let note: string | null = null;
	if (extra.length > 0) {
		const more = Math.max(...extra.map((s) => s.amountCents)) - base;
		note = extra.length === 1 && extra[0].uid === payerUid
			? `${payerName ?? "Você"} fica com ${centavos(more)} a mais`
			: extra.length === 1
				? `Uma pessoa fica com ${centavos(more)} a mais`
				: `${extra.length} pessoas ficam com ${centavos(more)} a mais`;
	}
	return { kind: "ok", line, note, othersCents, baseCents: base, people: shares.length };
}

/** "Fica R$ 30,00 por pessoa em cada parcela" (ou, com uma pessoa só, "... para a pessoa escolhida em cada parcela"). */
export function installmentSplitLine(p: { baseCents: number; people: number }): string {
	return p.people === 1 ? `Fica ${formatBRL(p.baseCents)} para a pessoa escolhida em cada parcela` : `Fica ${formatBRL(p.baseCents)} por pessoa em cada parcela`;
}

/** "Fica R$ 300,00 por pessoa em cada mês" (despesa fixa). */
export function monthlySplitLine(p: { baseCents: number; people: number }): string {
	return p.people === 1 ? `Fica ${formatBRL(p.baseCents)} para a pessoa escolhida em cada mês` : `Fica ${formatBRL(p.baseCents)} por pessoa em cada mês`;
}
