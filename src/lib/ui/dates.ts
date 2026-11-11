const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = [
	"janeiro", "fevereiro", "março", "abril", "maio", "junho",
	"julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo, o mesmo que o servidor usa. */
export function todayISO(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Sao_Paulo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

function parts(iso: string): { y: number; m: number; d: number } | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	return { y, m: mo, d };
}

/** Dia anterior, em texto ISO (sem depender do fuso do aparelho). */
function previousDay(iso: string): string {
	const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

/** "Hoje", "Ontem" ou "12 nov" (com o ano quando não é o ano atual: "12 nov 2025"). */
export function formatDateShort(iso: string, today: string = todayISO()): string {
	const p = parts(iso);
	if (!p) return "";
	const day = iso.slice(0, 10);
	if (day === today) return "Hoje";
	if (day === previousDay(today)) return "Ontem";
	const base = `${p.d} ${MONTHS_SHORT[p.m - 1]}`;
	const currentYear = Number(today.slice(0, 4));
	return p.y === currentYear ? base : `${base} ${p.y}`;
}

/** "12 de novembro de 2026". */
export function formatDateLong(iso: string): string {
	const p = parts(iso);
	if (!p) return "";
	return `${p.d} de ${MONTHS_LONG[p.m - 1]} de ${p.y}`;
}

/** Data de calendário real no formato YYYY-MM-DD? */
export function isValidISODate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
