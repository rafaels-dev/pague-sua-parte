import { formatBRL } from "@/lib/money";
import { isValidISODate } from "./dates";

const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = [
	"janeiro", "fevereiro", "março", "abril", "maio", "junho",
	"julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 48;

function parts(iso: string): { y: number; m: number; d: number } | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	return { y, m: mo, d };
}

function daysInMonth(y: number, month1: number): number {
	return new Date(Date.UTC(y, month1, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string {
	return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Soma `months` meses a uma data, sempre a partir do dia ORIGINAL e cortando no fim do mês:
 * 31 jan + 1 = 28 (ou 29) fev; 31 jan + 2 = 31 mar (não 28 mar). Data inválida vira "".
 */
export function addMonthsClamped(isoDate: string, months: number): string {
	const p = parts(isoDate);
	if (!p || !isValidISODate(isoDate.slice(0, 10))) return "";
	const index = p.y * 12 + (p.m - 1) + months;
	const y = Math.floor(index / 12);
	const m = (index % 12) + 1;
	return iso(y, m, Math.min(p.d, daysInMonth(y, m)));
}

/** Vencimentos mensais de um parcelado: a primeira data e as seguintes, sempre contando a partir da PRIMEIRA. */
export function installmentSchedule(firstDue: string, count: number): string[] {
	if (!isValidISODate(firstDue) || !Number.isInteger(count) || count < 1) return [];
	return Array.from({ length: count }, (_, i) => addMonthsClamped(firstDue, i));
}

/** Leva o número de parcelas para o intervalo permitido (2 a 48); algo que não é número vira 2. */
export function clampInstallments(n: number): number {
	if (!Number.isFinite(n)) return MIN_INSTALLMENTS;
	return Math.min(MAX_INSTALLMENTS, Math.max(MIN_INSTALLMENTS, Math.round(n)));
}

/**
 * Meses dos vencimentos, em forma curta: "dez, jan, fev, mar, abr, mai".
 * Quando o ano muda no meio, ele aparece só no primeiro mês do ano novo: "nov, dez, jan 27, fev".
 * Mais de 12 parcelas: resume em "dez 26 a nov 27" para não virar um paredão.
 */
export function dueMonthsShort(schedule: string[]): string {
	const ps = schedule.map(parts).filter((p): p is NonNullable<ReturnType<typeof parts>> => p !== null);
	if (ps.length === 0) return "";
	const label = (p: { y: number; m: number }, withYear: boolean) => `${MONTHS_SHORT[p.m - 1]}${withYear ? ` ${String(p.y).slice(2)}` : ""}`;
	if (ps.length > 12) {
		const first = ps[0];
		const last = ps[ps.length - 1];
		return `${label(first, true)} a ${label(last, true)}`;
	}
	return ps.map((p, i) => label(p, i === 0 ? false : p.y !== ps[i - 1].y)).join(", ");
}

/** "6 × R$ 120,00 = R$ 720,00". */
export function installmentTotalLine(count: number, eachCents: number): string {
	return `${count} × ${formatBRL(eachCents)} = ${formatBRL(count * eachCents)}`;
}

/** "10 de dezembro" (com o ano quando não é o ano atual: "10 de dezembro de 2027"). */
export function formatDueLong(isoDate: string, today: string): string {
	const p = parts(isoDate);
	if (!p) return "";
	const base = `${p.d} de ${MONTHS_LONG[p.m - 1]}`;
	return p.y === Number(today.slice(0, 4)) ? base : `${base} de ${p.y}`;
}

/** "10/12" (com o ano em dois dígitos quando não é o ano atual: "10/12/27"). */
export function formatDueNumeric(isoDate: string, today: string): string {
	const p = parts(isoDate);
	if (!p) return "";
	const base = `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}`;
	return p.y === Number(today.slice(0, 4)) ? base : `${base}/${String(p.y).slice(2)}`;
}

/** "dezembro" (com o ano quando não é o atual: "janeiro de 2027"). */
export function formatMonthLong(isoDate: string, today: string): string {
	const p = parts(isoDate);
	if (!p) return "";
	return p.y === Number(today.slice(0, 4)) ? MONTHS_LONG[p.m - 1] : `${MONTHS_LONG[p.m - 1]} de ${p.y}`;
}

/** Nome do mês da data, sem ano: "novembro" (para "até o fim de novembro"). */
export function monthName(isoDate: string): string {
	const p = parts(isoDate);
	return p ? MONTHS_LONG[p.m - 1] : "";
}

/** Ainda não venceu? Vence hoje ou depois. */
function isPast(dueDate: string, today: string): boolean {
	return dueDate.slice(0, 10) < today;
}

export type DueInfo = { text: string; overdue: boolean };

/** Frase da página da despesa: "Vence em 10 de dezembro" / "Venceu em 10 de novembro". Sem data, null. */
export function dueLong(dueDate: string | null, overdue: boolean, today: string): DueInfo | null {
	if (!dueDate) return null;
	const when = formatDueLong(dueDate, today);
	if (!when) return null;
	const past = overdue || isPast(dueDate, today);
	return { text: `${past ? "Venceu" : "Vence"} em ${when}`, overdue };
}

/** Frase curta da lista: "Vence 10/12" / "Venceu 10/11". */
export function dueShort(dueDate: string | null, overdue: boolean, today: string): DueInfo | null {
	if (!dueDate) return null;
	const when = formatDueNumeric(dueDate, today);
	if (!when) return null;
	const past = overdue || isPast(dueDate, today);
	return { text: `${past ? "Venceu" : "Vence"} ${when}`, overdue };
}

/** "Parcela 2 de 6". */
export function installmentLabel(i: { number: number; count: number }): string {
	return `Parcela ${i.number} de ${i.count}`;
}

/** "Parcela 2/6" (compacto, para a lista). */
export function installmentShort(i: { number: number; count: number }): string {
	return `Parcela ${i.number}/${i.count}`;
}

export type SeriesItemState = "paid" | "overdue" | "open";

/** Estado de uma parcela da série: paga, vencida (aberta e com data passada) ou em aberto. */
export function seriesItemState(item: { dueDate: string | null; settled: boolean }, today: string): SeriesItemState {
	if (item.settled) return "paid";
	return item.dueDate && isPast(item.dueDate, today) ? "overdue" : "open";
}

export const SERIES_STATE_TEXT: Record<SeriesItemState, string> = { paid: "Paga", overdue: "Vencida", open: "Em aberto" };

/** Próxima vez que o dia `day` (1 a 31) acontece, de hoje em diante (hoje conta); corta no fim do mês curto. */
export function nextDayOfMonth(today: string, day: number): string {
	const p = parts(today);
	if (!p || !Number.isInteger(day) || day < 1 || day > 31) return "";
	const thisMonth = iso(p.y, p.m, Math.min(day, daysInMonth(p.y, p.m)));
	if (thisMonth >= today) return thisMonth;
	const base = iso(p.y, p.m, 1);
	const next = addMonthsClamped(base, 1);
	const np = parts(next)!;
	return iso(np.y, np.m, Math.min(day, daysInMonth(np.y, np.m)));
}

/** Mesmo dia do mês que vem. */
export function nextMonthSameDay(today: string): string {
	return addMonthsClamped(today, 1);
}

/** Vencimento válido? Data real, não antes do dia da compra e sem ano absurdo (digitado errado). */
export function isValidDueDate(due: string, purchaseDate: string, today: string): boolean {
	if (!isValidISODate(due)) return false;
	if (due < purchaseDate) return false;
	return Number(due.slice(0, 4)) <= Number(today.slice(0, 4)) + 5;
}

/** Texto do aviso do grupo de uma compra parcelada. */
export function buildInstallmentShareText(e: { amountCents: number; description: string; installmentCount: number; /** Parcelas com valores diferentes: não diz o valor de cada uma. */ withoutValue?: boolean }, link: string): string {
	const description = e.description.trim().replace(/[\s.]+$/, "");
	const what = e.withoutValue ? `${e.installmentCount} parcelas` : `${e.installmentCount} parcelas de ${formatBRL(e.amountCents)}`;
	return `Paguei uma nova despesa de ${what}, referente a ${description}. Abra o link e pague sua parte. ${link}`;
}

/** "R$ 300,00 até o fim de novembro" quando o valor "de agora" difere do total; senão null. */
export function untilEndOfMonthLine(totalCents: number, nowCents: number, today: string): string | null {
	if (nowCents === totalCents) return null;
	return `${formatBRL(nowCents)} até o fim de ${monthName(today)}`;
}

type BalanceLike = {
	toReceiveCents: number;
	toPayCents: number;
	toReceiveNowCents: number;
	toPayNowCents: number;
	overdueToPayCents: number;
};

/**
 * Uma única linha extra, bem curta, para cartões compactos (grupo, pessoa que você cuida): o vencido tem prioridade,
 * depois o que falta pagar neste mês, depois o que vai receber. Nada de especial: null.
 */
export function compactBalanceLine(b: BalanceLike): { text: string; tone: "error" | "muted" } | null {
	if (b.overdueToPayCents > 0) return { text: `${formatBRL(b.overdueToPayCents)} vencido`, tone: "error" };
	if (b.toPayCents > 0 && b.toPayNowCents !== b.toPayCents) return { text: `A pagar ${formatBRL(b.toPayNowCents)} neste mês`, tone: "muted" };
	if (b.toReceiveCents > 0 && b.toReceiveNowCents !== b.toReceiveCents) return { text: `A receber ${formatBRL(b.toReceiveNowCents)} neste mês`, tone: "muted" };
	return null;
}

/** Recado depois de apagar: "Despesa apagada.", "Parcela apagada." ou "5 parcelas apagadas. 1 mantida porque já tem pagamento." */
export function deleteFlashMessage(opts: { scope: "this" | "following"; installment: boolean; deleted?: number; kept?: number }): string {
	if (opts.scope === "this") return opts.installment ? "Parcela apagada." : "Despesa apagada.";
	const deleted = Math.max(1, opts.deleted ?? 1);
	const kept = Math.max(0, opts.kept ?? 0);
	const first = deleted === 1 ? "1 parcela apagada" : `${deleted} parcelas apagadas`;
	if (kept === 0) return `${first}.`;
	return `${first}. ${kept === 1 ? "1 mantida porque já tem pagamento" : `${kept} mantidas porque já têm pagamento`}.`;
}
