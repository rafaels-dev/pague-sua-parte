import { formatBRL } from "@/lib/money";

/** Período do relatório, como a API espera: "all", "month:YYYY-MM" ou "year:YYYY". */
export type ReportPeriod = "all" | `month:${string}` | `year:${string}`;
export type PeriodKind = "all" | "month" | "year";

const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function periodKind(period: ReportPeriod): PeriodKind {
	return period.startsWith("month:") ? "month" : period.startsWith("year:") ? "year" : "all";
}

/** "2026-11" a partir de "2026-11-11" (ou de qualquer data ISO). */
export function monthOf(iso: string): string {
	return iso.slice(0, 7);
}

export const currentMonthPeriod = (today: string): ReportPeriod => `month:${monthOf(today)}`;
export const currentYearPeriod = (today: string): ReportPeriod => `year:${today.slice(0, 4)}`;

/** Muda o período ao tocar em "Tudo" / "Este mês" / "Este ano". */
export function periodFor(kind: PeriodKind, today: string): ReportPeriod {
	return kind === "month" ? currentMonthPeriod(today) : kind === "year" ? currentYearPeriod(today) : "all";
}

function splitMonth(month: string): { y: number; m: number } | null {
	const r = /^(\d{4})-(\d{2})$/.exec(month);
	if (!r) return null;
	const m = Number(r[2]);
	return m >= 1 && m <= 12 ? { y: Number(r[1]), m } : null;
}

/** Soma (ou subtrai) meses de "YYYY-MM". */
export function shiftMonth(month: string, delta: number): string {
	const p = splitMonth(month);
	if (!p) return month;
	const index = p.y * 12 + (p.m - 1) + delta;
	const y = Math.floor(index / 12);
	return `${String(y).padStart(4, "0")}-${String(((index % 12) + 12) % 12 + 1).padStart(2, "0")}`;
}

/** Mês anterior / seguinte de um período mensal; o seguinte nunca passa do mês de hoje. */
export function stepMonthPeriod(period: ReportPeriod, delta: -1 | 1, today: string): ReportPeriod | null {
	if (periodKind(period) !== "month") return null;
	const next = shiftMonth(period.slice(6), delta);
	if (next > monthOf(today)) return null;
	return `month:${next}`;
}

/** "novembro de 2026" (minúsculo). */
export function monthLabel(month: string): string {
	const p = splitMonth(month);
	return p ? `${MONTHS_LONG[p.m - 1]} de ${p.y}` : "";
}

/** "nov" ou "nov 25" quando não é o ano de hoje. */
export function monthShort(month: string, today: string): string {
	const p = splitMonth(month);
	if (!p) return "";
	return String(p.y) === today.slice(0, 4) ? MONTHS_SHORT[p.m - 1] : `${MONTHS_SHORT[p.m - 1]} ${String(p.y).slice(2)}`;
}

/** Nome do período para o título: "Todo o período", "Novembro de 2026", "Ano de 2026". */
export function periodLabel(period: ReportPeriod): string {
	const kind = periodKind(period);
	if (kind === "all") return "Todo o período";
	if (kind === "year") return `Ano de ${period.slice(5)}`;
	const label = monthLabel(period.slice(6));
	return label.charAt(0).toUpperCase() + label.slice(1);
}

export type FairnessTone = "good" | "ok" | "low";
/** Palavras simples para o equilíbrio (nunca vermelho: só texto e o mesmo tom da barra). */
export function fairnessWords(percent: number): { label: string; tone: FairnessTone } {
	if (percent >= 85) return { label: "Bem dividido", tone: "good" };
	if (percent >= 60) return { label: "Dá para equilibrar melhor", tone: "ok" };
	return { label: "Poucas pessoas estão carregando a maior parte", tone: "low" };
}

export const FAIRNESS_EXPLANATION = "100% quer dizer que todo mundo arcou com a mesma parte das despesas.";

export type ReportPerson = {
	uid: string;
	name: string;
	picture: string | null;
	kind: "user" | "managed";
	isYou: boolean;
	youManage: boolean;
	stillMember: boolean;
	advancedCents: number;
	shareCents: number;
	bornCents: number;
	pendingCents: number;
	owedBackCents: number;
	helpedCount: number;
	expensesPaidCount: number;
	/** Pontos-base: 0 a 10000. */
	bornPercent: number;
};
export type ReportData = {
	period: string;
	groupName: string;
	expenseCount: number;
	totalCents: number;
	equalShareCents: number;
	fairnessPercent: number;
	people: ReportPerson[];
	months: { month: string; totalCents: number }[];
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Aceita a resposta do servidor e completa o que faltar; devolve null se não parece um relatório. */
export function normalizeReport(raw: unknown): ReportData | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (!Array.isArray(r.people) && typeof r.totalCents !== "number") return null;
	const people: ReportPerson[] = (Array.isArray(r.people) ? (r.people as Record<string, unknown>[]) : [])
		.filter((p) => p && typeof p === "object")
		.map((p) => {
			const born = Math.max(0, num(p.bornCents));
			return {
				uid: typeof p.uid === "string" ? p.uid : "",
				name: typeof p.name === "string" ? p.name : "",
				picture: typeof p.picture === "string" ? p.picture : null,
				kind: (p.kind === "managed" ? "managed" : "user") as "user" | "managed",
				isYou: !!p.isYou,
				youManage: !!p.youManage,
				stillMember: p.stillMember !== false,
				advancedCents: Math.max(0, num(p.advancedCents)),
				shareCents: Math.max(0, num(p.shareCents)),
				bornCents: born,
				pendingCents: Math.max(0, num(p.pendingCents)),
				owedBackCents: Math.max(0, num(p.owedBackCents)),
				helpedCount: Math.max(0, Math.round(num(p.helpedCount))),
				expensesPaidCount: Math.max(0, Math.round(num(p.expensesPaidCount))),
				bornPercent: clamp(num(p.bornPercent), 0, 10000),
			};
		})
		.sort((a, b) => b.bornCents - a.bornCents);
	const months = (Array.isArray(r.months) ? (r.months as Record<string, unknown>[]) : [])
		.filter((m) => m && typeof m.month === "string" && /^\d{4}-\d{2}$/.test(m.month))
		.map((m) => ({ month: m.month as string, totalCents: Math.max(0, num(m.totalCents)) }))
		.sort((a, b) => a.month.localeCompare(b.month));
	return {
		period: typeof r.period === "string" ? r.period : "all",
		groupName: typeof r.groupName === "string" ? r.groupName : "",
		expenseCount: Math.max(0, Math.round(num(r.expenseCount))),
		totalCents: Math.max(0, num(r.totalCents)),
		equalShareCents: Math.max(0, num(r.equalShareCents)),
		fairnessPercent: clamp(Math.round(num(r.fairnessPercent)), 0, 100),
		people,
		months,
	};
}

/** Escala única das barras: a maior entre o maior valor e a parte igual. */
export function barScale(people: Pick<ReportPerson, "bornCents">[], equalShareCents: number): number {
	return Math.max(equalShareCents, ...people.map((p) => p.bornCents), 0);
}

/** Largura (0 a 100) de um valor na escala; quem contribuiu algo ganha pelo menos 2% para a barra aparecer. */
export function barPercent(cents: number, scale: number): number {
	if (scale <= 0 || cents <= 0) return 0;
	return clamp((cents / scale) * 100, 2, 100);
}

/** Posição (0 a 100) da marca da parte igual. */
export function markerPercent(equalShareCents: number, scale: number): number {
	return scale <= 0 ? 0 : clamp((equalShareCents / scale) * 100, 0, 100);
}

/** "40%" a partir de pontos-base; "menos de 1%" quando é pouco mas não zero. */
export function percentText(basisPoints: number): string {
	if (basisPoints <= 0) return "0%";
	const pct = Math.round(basisPoints / 100);
	return pct === 0 ? "menos de 1%" : `${pct}%`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Legendas da pessoa: "sem celular", "saiu do grupo". */
export function personCaption(p: Pick<ReportPerson, "kind" | "stillMember">): string | null {
	const parts = [p.kind === "managed" ? "sem celular" : null, p.stillMember ? null : "saiu do grupo"].filter(Boolean);
	return parts.length ? parts.join(" · ") : null;
}

/** Fatos pequenos da pessoa, só os que não são zero. */
export function personFacts(p: ReportPerson): string[] {
	const out: string[] = [];
	if (p.advancedCents > 0) out.push(p.expensesPaidCount > 0 ? `Adiantou ${formatBRL(p.advancedCents)} em ${plural(p.expensesPaidCount, "despesa", "despesas")}` : `Adiantou ${formatBRL(p.advancedCents)}`);
	if (p.pendingCents > 0) out.push(`Ainda vai pagar ${formatBRL(p.pendingCents)}`);
	if (p.helpedCount > 0) out.push(`Ajudou em ${plural(p.helpedCount, "despesa", "despesas")}`);
	return out;
}

/** Valor curto em reais inteiros, para o histórico mês a mês: "1.235". */
export function shortBRL(cents: number): string {
	return Math.round(cents / 100).toLocaleString("pt-BR");
}
