/** Textos e decisões puras sobre pagamento parcial de uma parte (sem React). */

import { formatBRL } from "@/lib/money";

/** Selo da parte que já recebeu algum pagamento mas ainda não foi quitada. Nunca "Pago". */
export const PARTIAL_CHIP = "Pago parcialmente";

/**
 * O que o aviso de "paguei" diz de uma parte já paga: o valor realmente pago no ÚLTIMO pagamento (vindo do servidor, `last`) e se ele
 * quitou o que faltava depois de parciais. Sem parciais é a parte inteira, como sempre.
 */
export function paidNoticeAmount(s: { amountCents: number; parts: unknown[]; last?: { cents: number; partial: boolean } | null }): { amountCents: number; afterParts: boolean } {
	const afterParts = s.parts.length > 0 && !!s.last && !s.last.partial;
	return { amountCents: afterParts ? s.last!.cents : s.amountCents, afterParts };
}

/** "Faltam R$ 53,00 · já pagou R$ 47,00". */
export function partialLine(paidCents: number, dueCents: number): string {
	return `Faltam ${formatBRL(dueCents)} · já pagou ${formatBRL(paidCents)}`;
}

/** A parte em aberto já recebeu pagamento? */
export const isPartial = (s: { status: string; paidCents: number; dueCents: number }): boolean => s.status === "pending" && s.paidCents > 0 && s.dueCents > 0;

export type AmountCheck =
	| { kind: "empty" }
	| { kind: "too_much"; message: string }
	/** Valor menor que o que falta: a parte continua em aberto. */
	| { kind: "part"; remainingCents: number }
	/** Valor igual ao que falta: quita a parte. */
	| { kind: "full" };

/** Confere o valor digitado em "Pagar outro valor" / "Recebi só uma parte" contra o que falta pagar. */
export function checkAmount(cents: number, dueCents: number): AmountCheck {
	if (!Number.isSafeInteger(cents) || cents < 1) return { kind: "empty" };
	if (cents > dueCents) return { kind: "too_much", message: `Esse valor é maior do que falta pagar (${formatBRL(dueCents)}).` };
	return cents === dueCents ? { kind: "full" } : { kind: "part", remainingCents: dueCents - cents };
}

/** Frase embaixo do campo: "Vai faltar R$ 53,00" ou "Isso paga o que falta". */
export function amountHint(check: AmountCheck): string | null {
	if (check.kind === "part") return `Vai faltar ${formatBRL(check.remainingCents)}`;
	if (check.kind === "full") return "Esse valor paga tudo o que falta.";
	return null;
}

export type PartLike = { cents: number; method: "manual" | "self"; byAdmin: boolean; markedByName: string | null };

/** Linha do histórico de um pagamento parcial: "R$ 47,00 · hoje · avisou que pagou". */
export function partLine(p: PartLike, when: string): string {
	const date = when ? ` · ${when}` : "";
	const how =
		p.method === "self"
			? "avisou que pagou"
			: p.byAdmin
				? `recebido, marcado pelo administrador${p.markedByName ? ` (${p.markedByName})` : ""}`
				: "recebido por quem pagou a conta";
	return `${formatBRL(p.cents)}${date} · ${how}`;
}

/**
 * Valor do ÚLTIMO pagamento (o mesmo que o servidor desfaz, vindo de `last`), quando a frase "O último pagamento (R$ X) some" cabe:
 * parte em aberto ou último pagamento parcial. Quando "Desfazer" tira a quitação inteira de uma parte paga, undefined (texto de sempre).
 */
export function undoPartCentsOf(s: { status: string; last?: { cents: number; partial: boolean } | null }): number | undefined {
	const l = s.last;
	if (!l) return undefined;
	return s.status === "pending" || l.partial ? l.cents : undefined;
}
