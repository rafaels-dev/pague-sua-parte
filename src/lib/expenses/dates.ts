/** Datas de calendário (YYYY-MM-DD), sem fuso: a matemática é toda em UTC sobre o texto. */

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function todayInSaoPaulo(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Sao_Paulo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

export function isRealDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(s: string, days: number): string {
	const d = new Date(`${s}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/**
 * `date` mais `months` meses, mantendo o dia e limitando ao último dia de meses mais curtos
 * (31/01 -> 28 ou 29/02 -> 31/03). Calcule sempre a partir da data ORIGINAL, nunca encadeando.
 */
export function addMonthsClamped(date: string, months: number): string {
	const [y, m, d] = date.split("-").map(Number);
	const idx = y * 12 + (m - 1) + months;
	const year = Math.floor(idx / 12);
	const month0 = idx - year * 12;
	return `${pad(year, 4)}-${pad(month0 + 1)}-${pad(Math.min(d, daysInMonth(year, month0)))}`;
}

/** Vencimentos de uma série parcelada: a primeira data + (n-1) meses, n = 1..count. */
export function installmentDueDates(firstDueDate: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => addMonthsClamped(firstDueDate, i));
}

/** Último dia do mês de `date`. */
export function lastDayOfMonth(date: string): string {
	const [y, m] = date.split("-").map(Number);
	return `${pad(y, 4)}-${pad(m)}-${pad(daysInMonth(y, m - 1))}`;
}

/** "Agora" nos saldos: sem vencimento, ou vencimento até o último dia do mês de hoje (São Paulo). */
export function isDueNow(dueDate: string | null | undefined, today: string): boolean {
	return !dueDate || dueDate <= lastDayOfMonth(today);
}

export function isPastDue(dueDate: string | null | undefined, today: string): boolean {
	return Boolean(dueDate) && (dueDate as string) < today;
}
