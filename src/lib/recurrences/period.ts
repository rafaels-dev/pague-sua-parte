import { addMonthsClamped, todayInSaoPaulo } from "@/lib/expenses/dates";

/** Mês de calendário "YYYY-MM". */
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Meses gerados de uma vez, no máximo, quando o app ficou parado (o resto vem nas leituras seguintes). */
export const MAX_CATCH_UP = 12;
export const MAX_START_MONTHS_AHEAD = 12;
export const MAX_END_YEARS_AHEAD = 5;

export function isPeriod(s: unknown): s is string {
	return typeof s === "string" && PERIOD_RE.test(s);
}

/** Mês de hoje (São Paulo). */
export function currentPeriod(now: Date = new Date()): string {
	return todayInSaoPaulo(now).slice(0, 7);
}

/** `period` mais `months` meses (pode ser negativo). */
export function addPeriods(period: string, months: number): string {
	return addMonthsClamped(`${period}-01`, months).slice(0, 7);
}

const lastDay = (period: string) => {
	const [y, m] = period.split("-").map(Number);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Dia `dayOfMonth` do mês, limitado ao último dia (dia 31 em fevereiro vira 28 ou 29). */
export function dueDateFor(period: string, dayOfMonth: number): string {
	return `${period}-${String(Math.min(dayOfMonth, lastDay(period))).padStart(2, "0")}`;
}

/** Primeiro mês a gerar: este, se o dia ainda não passou; senão o próximo. */
export function defaultStartPeriod(dayOfMonth: number, now: Date = new Date()): string {
	const today = todayInSaoPaulo(now);
	const period = today.slice(0, 7);
	return dayOfMonth >= Number(today.slice(8, 10)) ? period : addPeriods(period, 1);
}

/** Meses a gerar agora: de `next` até o mês atual (e até `end`), no máximo `cap`. */
export function periodsToGenerate(next: string, current: string, end: string | undefined | null, cap: number = MAX_CATCH_UP): string[] {
	const out: string[] = [];
	for (let p = next; p <= current && (!end || p <= end) && out.length < cap; p = addPeriods(p, 1)) out.push(p);
	return out;
}

export type ParticipantMode = "all" | "selected" | "alone";

/**
 * Quem divide o mês. "all": todos os membros de agora; "selected": os escolhidos que ainda são membros, na ordem
 * guardada (quem paga só entra se estiver na lista, como num lançamento comum); "alone" (ou nada sobrou): só quem paga.
 */
export function resolveParticipants(mode: ParticipantMode, selected: string[], memberUids: string[], payer: string): string[] {
	if (mode === "all") return [...new Set(memberUids)];
	if (mode === "selected") {
		const members = new Set(memberUids);
		const kept = [...new Set(selected)].filter((u) => members.has(u));
		if (kept.length > 0) return kept;
	}
	return [payer];
}
