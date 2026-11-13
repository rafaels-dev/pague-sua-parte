import { formatBRL } from "@/lib/money";
import { netPerInstallment, type CashbackMode } from "@/lib/expenses/cashback";
import type { PaymentKind } from "@/components/expenses/payment-choice";
import { splitPreview } from "./split-preview";

/** Linha do detalhe: "Custou R$ 1.000,00 · cashback R$ 50,00" (numa parcela: "Esta parcela custou ..."). */
export function cashbackDetailLine(netCents: number, cashbackCents: number, installment = false): string {
	return `${installment ? "Esta parcela custou" : "Custou"} ${formatBRL(netCents + cashbackCents)} · cashback ${formatBRL(cashbackCents)}`;
}

/** Texto curto na edição: o valor já está sem o cashback. */
export function cashbackEditNote(cashbackCents: number): string {
	return `Esta compra teve ${formatBRL(cashbackCents)} de cashback. O valor acima já está com o cashback descontado.`;
}

export type CashbackPlan =
	| { ok: true; nets: number[]; grossTotalCents: number; netTotalCents: number }
	| { ok: false; error: string };

/** Valor que sobra para dividir em cada parcela (ou na compra à vista, `count` = 1), conferido como no servidor. */
export function cashbackPlan(grossEachCents: number, count: number, cashbackCents: number, mode: CashbackMode): CashbackPlan {
	if (grossEachCents <= 0 || cashbackCents <= 0) return { ok: false, error: "" };
	const r = netPerInstallment(grossEachCents, count, cashbackCents, mode);
	if (!r.ok) return { ok: false, error: r.error };
	const nets = r.nets;
	return { ok: true, nets, grossTotalCents: grossEachCents * count, netTotalCents: nets.reduce((s, n) => s + n, 0) };
}

/** "Fica R$ 950,00 para dividir (R$ 1.000,00 menos R$ 50,00 de cashback)." */
export function cashbackDivideLine(plan: Extract<CashbackPlan, { ok: true }>): string {
	return `Fica ${formatBRL(plan.netTotalCents)} para dividir (${formatBRL(plan.grossTotalCents)} menos ${formatBRL(plan.grossTotalCents - plan.netTotalCents)} de cashback).`;
}

/**
 * Parcelas com valores diferentes: não promete valor igual em todas.
 * Cashback só na primeira: "... na 1ª parcela e ... nas outras". Resto de centavos: "cerca de ... em cada parcela".
 * Parcelas iguais: null (vale a frase de sempre).
 * Comparar a primeira e a última parcela basta: só existem dois valores (ver `netPerInstallment`), o menor na primeira.
 */
export function differingInstallmentTexts(
	nets: number[],
	mode: CashbackMode,
	participantUids: string[],
	payerUid: string,
	payerName?: string,
): { line: string; othersChunk: string } | null {
	if (nets.every((n) => n === nets[0])) return null;
	const first = splitPreview(nets[0], participantUids, payerUid, payerName);
	const last = splitPreview(nets[nets.length - 1], participantUids, payerUid, payerName);
	if (first.kind !== "ok" || last.kind !== "ok") return null;
	const who = first.people === 1 ? "para a pessoa escolhida" : "por pessoa";
	if (mode === "first") {
		return {
			line: `Fica ${formatBRL(first.baseCents)} ${who} na 1ª parcela e ${formatBRL(last.baseCents)} nas outras`,
			othersChunk: `${formatBRL(first.othersCents)} na 1ª parcela e ${formatBRL(last.othersCents)} nas outras`,
		};
	}
	return {
		line: `Fica cerca de ${formatBRL(first.baseCents)} ${who} em cada parcela`,
		othersChunk: `cerca de ${formatBRL(first.othersCents)} em cada parcela`,
	};
}

/** Cashback que vai no envio: nada em "todo mês" (o campo some) nem sem valor; modo só com parcelas. */
export function cashbackForSubmit(payment: PaymentKind, cents: number, mode: CashbackMode): { cents: number; mode?: CashbackMode } | null {
	if (payment === "monthly" || cents <= 0) return null;
	return { cents, ...(payment === "installments" ? { mode } : {}) };
}

/** Problemas do cashback ao lançar; em "todo mês" o cashback é ignorado. */
export function cashbackFormProblems(p: {
	payment: PaymentKind;
	amountCents: number;
	installments: number;
	cents: number;
	mode: CashbackMode;
	people: number;
}): { cashback?: string; participants?: string } {
	if (cashbackForSubmit(p.payment, p.cents, p.mode) === null || p.amountCents <= 0) return {};
	const plan = cashbackPlan(p.amountCents, p.payment === "installments" ? p.installments : 1, p.cents, p.mode);
	if (!plan.ok) return { cashback: plan.error };
	if (p.people > 0 && plan.nets.some((n) => n < p.people)) return { participants: "O valor é pequeno demais para dividir entre tantas pessoas." };
	return {};
}
