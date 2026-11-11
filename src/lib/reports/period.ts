/** Período do relatório, sobre a data da COMPRA (`date`, YYYY-MM-DD). */
export type Period = { kind: "all" } | { kind: "month"; month: string } | { kind: "year"; year: string };

const MONTH_RE = /^month:(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^year:(\d{4})$/;

/** `all` (padrão quando ausente), `month:YYYY-MM` ou `year:YYYY`; qualquer outra coisa é null. */
export function parsePeriod(raw: string | null | undefined): Period | null {
	if (raw === null || raw === undefined || raw === "" || raw === "all") return { kind: "all" };
	const m = MONTH_RE.exec(raw);
	if (m) return { kind: "month", month: `${m[1]}-${raw.slice(-2)}` };
	const y = YEAR_RE.exec(raw);
	if (y) return { kind: "year", year: y[1] };
	return null;
}

export function periodKey(p: Period): string {
	return p.kind === "all" ? "all" : p.kind === "month" ? `month:${p.month}` : `year:${p.year}`;
}

/** Filtro por `date` (comparação de texto: datas ISO ordenam como texto). */
export function dateFilter(p: Period): { date?: { $gte: string; $lte: string } } {
	if (p.kind === "all") return {};
	if (p.kind === "month") return { date: { $gte: `${p.month}-01`, $lte: `${p.month}-31` } };
	return { date: { $gte: `${p.year}-01-01`, $lte: `${p.year}-12-31` } };
}

/** O mesmo filtro como predicado (referência em JS). */
export function inPeriod(date: string, p: Period): boolean {
	const f = dateFilter(p).date;
	return !f || (date >= f.$gte && date <= f.$lte);
}
