import { formatBRL } from "@/lib/money";
import { formatDueLong, monthName, nextDayOfMonth } from "./due-dates";

export const MIN_DAY = 1;
export const MAX_DAY = 31;
export const DEFAULT_DAY = 10;
export const RECURRING_CHIP = "Todo mês";

const MONTHS_LONG = [
	"janeiro", "fevereiro", "março", "abril", "maio", "junho",
	"julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Leva o dia do mês para o intervalo 1 a 31; algo que não é número vira o dia padrão. */
export function clampDay(n: number): number {
	if (!Number.isFinite(n)) return DEFAULT_DAY;
	return Math.min(MAX_DAY, Math.max(MIN_DAY, Math.trunc(n)));
}

/** Primeiro vencimento: este mês se o dia ainda não passou (hoje conta), senão o mês que vem; corta no fim do mês curto. */
export function firstDueDate(today: string, day: number): string {
	return nextDayOfMonth(today, clampDay(day));
}

/** "2026-11" (YYYY-MM) válido? */
export function isValidPeriod(s: string): boolean {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Mês de uma data ISO, como "2026-11". */
export function periodOf(isoDate: string): string {
	return isoDate.slice(0, 7);
}

/** "março de 2027" (YYYY-MM); texto vazio se inválido. */
export function periodLabel(period: string): string {
	if (!isValidPeriod(period)) return "";
	return `${MONTHS_LONG[Number(period.slice(5, 7)) - 1]} de ${period.slice(0, 4)}`;
}

/** "Todo dia 25, R$ 300,00". */
export function recurrenceSummaryLine(day: number, cents: number): string {
	return `Todo dia ${clampDay(day)}, ${formatBRL(cents)}`;
}

/** "A primeira vence em 25 de novembro". */
export function firstDueLine(firstDue: string, today: string): string {
	const when = formatDueLong(firstDue, today);
	return when ? `A primeira vence em ${when}` : "";
}

/** Aviso para os dias 29 a 31; nos demais, null. */
export function dayHint(day: number): string | null {
	const d = clampDay(day);
	return d >= 29 ? `Nos meses sem o dia ${d}, vale o último dia do mês.` : null;
}

/** "R$ 300,00 · todo dia 25". */
export function recurrenceLine(r: { amountCents: number; dayOfMonth: number }): string {
	return `${formatBRL(r.amountCents)} · todo dia ${r.dayOfMonth}`;
}

/** "Próxima: 25 de dezembro" (ou "Próxima: 25 de janeiro de 2027"); vazio sem data. */
export function nextDueLine(nextDueDate: string, today: string): string {
	const when = formatDueLong(nextDueDate, today);
	return when ? `Próxima: ${when}` : "";
}

/** "até março de 2027"; vazio quando não tem fim. */
export function endLine(endPeriod: string | null): string {
	if (!endPeriod) return "";
	const label = periodLabel(endPeriod);
	return label ? `até ${label}` : "";
}

/** Recado depois de criar sem despesa no mês atual: "Despesa fixa criada. A primeira aparece em dezembro." */
export function createdFlash(firstDue: string): string {
	const month = monthName(firstDue);
	return month ? `Despesa fixa criada. A primeira aparece em ${month}.` : "Despesa fixa criada.";
}

/** Problema com o mês final escolhido (null = tudo certo ou sem fim). `endPeriod`: null = sem fim, "" = ainda não escolheu. */
export function endPeriodProblem(endPeriod: string | null, firstDue: string): string | null {
	if (endPeriod === null) return null;
	if (!isValidPeriod(endPeriod)) return "Escolha o mês em que termina.";
	if (firstDue && endPeriod < periodOf(firstDue)) return `Escolha um mês a partir de ${periodLabel(periodOf(firstDue))}.`;
	return null;
}

/** "Quem paga: você" / "Quem paga: Maria" / "Quem paga: Benjamim (você cuida)". */
export function payerLine(p: { name: string; isYou: boolean; youManage?: boolean }): string {
	if (p.isYou) return "Quem paga: você";
	return `Quem paga: ${p.name}${p.youManage ? " (você cuida)" : ""}`;
}
