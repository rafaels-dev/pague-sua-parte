import { addDays, isPastDue } from "./dates";
import { dueCents, normalizeShares, refundCents, type ExpenseShare } from "./shares";

/** Janela de "Pagamentos para os próximos 15 dias": de hoje até hoje + 15 (inclusive). */
export const UPCOMING_DAYS = 15;
/** Quantas pessoas por despesa a resposta traz (o resto vira `moreOwes` / `moreRefunds`). */
export const MAX_PEOPLE_PER_EXPENSE = 8;

export type OpenSource = {
	_id?: { toHexString(): string } | string;
	paidBy: string;
	shares: ExpenseShare[];
	dueDate?: string | null;
	description?: string;
	amountCents?: number;
	date?: string;
	installment?: { number: number; count: number } | null;
	recurrence?: unknown;
	/** Mês de uma despesa fixa que ainda não virou despesa (só existe o modelo mensal). */
	fromTemplate?: boolean;
};

export type PersonAmount = { name: string; cents: number };

/** Uma despesa com algo em aberto. Só nomes e valores. */
export type OpenExpense = {
	/** Código estável da despesa (para o texto casar a mesma despesa em duas seções); nunca é impresso. */
	id: string;
	description: string;
	totalCents: number;
	paidByName: string;
	/** Só quando importa: venceu, ou vence nos próximos 15 dias. */
	dueDate: string | null;
	overdue: boolean;
	/** Quem ainda deve, com o que FALTA (parte já paga abatida), maiores primeiro. */
	owes: PersonAmount[];
	moreOwes: number;
	/** Devoluções que quem pagou ainda deve. */
	refunds: PersonAmount[];
	moreRefunds: number;
};

/** Parte a pagar com vencimento de hoje até hoje + 15 dias. */
export type UpcomingPayment = {
	id: string;
	dueDate: string;
	description: string;
	paidByName: string;
	owes: PersonAmount[];
	moreOwes: number;
};

/** "Parcela 2 de 6" / "despesa fixa": acrescentado à descrição, já que cada parcela e cada mês é uma despesa própria. */
export function labelFor(s: Pick<OpenSource, "installment" | "recurrence" | "fromTemplate">): string | null {
	if (s.installment) return `parcela ${s.installment.number} de ${s.installment.count}`;
	if (s.recurrence || s.fromTemplate) return "despesa fixa";
	return null;
}

const titleOf = (s: OpenSource) => {
	const base = (s.description ?? "").trim() || "Despesa";
	const label = labelFor(s);
	return label ? `${base} (${label})` : base;
};

const byAmount = (a: PersonAmount, b: PersonAmount) => b.cents - a.cents || a.name.localeCompare(b.name, "pt-BR");

function capped(list: PersonAmount[]): { shown: PersonAmount[]; more: number } {
	const sorted = [...list].sort(byAmount);
	return { shown: sorted.slice(0, MAX_PEOPLE_PER_EXPENSE), more: Math.max(0, sorted.length - MAX_PEOPLE_PER_EXPENSE) };
}

/**
 * As despesas em aberto do grupo (pronto para o texto de compartilhar) e os pagamentos dos próximos 15 dias.
 * Entra só quem tem algo em aberto (parte pendente ou devolução); linha de valor zero nunca aparece.
 * Ordem das despesas: atrasadas primeiro, depois por vencimento, depois as sem vencimento, da mais recente para a mais antiga.
 * Os pagamentos do período saem em ordem de vencimento (atrasadas e sem data ficam de fora; devolução não tem vencimento).
 * `upcomingTotalCents`/`upcomingCount` e `expenseCount` valem para tudo, mesmo depois de cortar em `maxExpenses`/`maxUpcoming`.
 */
export function buildOpenLists(
	sources: OpenSource[],
	today: string,
	nameOf: (uid: string) => string,
	caps: { maxExpenses: number; maxUpcoming: number },
): { expenses: OpenExpense[]; expenseCount: number; upcoming: UpcomingPayment[]; upcomingCount: number; upcomingTotalCents: number } {
	const windowEnd = addDays(today, UPCOMING_DAYS);
	type Row = { exp: OpenExpense; date: string; id: string; rank: number; dueSort: string };
	const rows: Row[] = [];
	const ups: (UpcomingPayment & { id: string })[] = [];
	let upcomingTotalCents = 0;
	for (const s of sources) {
		const due = s.dueDate ?? null;
		const overdue = isPastDue(due, today);
		const owes: PersonAmount[] = [];
		const refunds: PersonAmount[] = [];
		for (const share of normalizeShares(s.shares)) {
			if (share.uid === s.paidBy) continue;
			const owe = dueCents(share, s.paidBy);
			if (owe > 0) owes.push({ name: nameOf(share.uid), cents: owe });
			const back = refundCents(share, s.paidBy);
			if (back > 0) refunds.push({ name: nameOf(share.uid), cents: back });
		}
		if (owes.length === 0 && refunds.length === 0) continue;
		const id = typeof s._id === "string" ? s._id : (s._id?.toHexString() ?? "");
		const inWindow = due !== null && due >= today && due <= windowEnd;
		const o = capped(owes);
		const r = capped(refunds);
		if (!s.fromTemplate) {
			rows.push({
				exp: {
					id,
					description: titleOf(s),
					totalCents: s.amountCents ?? 0,
					paidByName: nameOf(s.paidBy),
					dueDate: overdue || inWindow ? due : null,
					overdue,
					owes: o.shown,
					moreOwes: o.more,
					refunds: r.shown,
					moreRefunds: r.more,
				},
				date: s.date ?? "",
				id,
				rank: overdue ? 0 : due ? 1 : 2,
				dueSort: due ?? "",
			});
		}
		if (inWindow && owes.length > 0) {
			upcomingTotalCents += owes.reduce((t, x) => t + x.cents, 0);
			ups.push({ dueDate: due as string, description: titleOf(s), paidByName: nameOf(s.paidBy), owes: o.shown, moreOwes: o.more, id });
		}
	}
	rows.sort((a, b) => a.rank - b.rank || a.dueSort.localeCompare(b.dueSort) || b.date.localeCompare(a.date) || b.id.localeCompare(a.id) || a.exp.description.localeCompare(b.exp.description, "pt-BR"));
	ups.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description, "pt-BR") || a.id.localeCompare(b.id));
	return {
		expenses: rows.slice(0, caps.maxExpenses).map((x) => x.exp),
		expenseCount: rows.length,
		upcoming: ups.slice(0, caps.maxUpcoming).map((u) => ({ id: u.id, dueDate: u.dueDate, description: u.description, paidByName: u.paidByName, owes: u.owes, moreOwes: u.moreOwes })),
		upcomingCount: ups.length,
		upcomingTotalCents,
	};
}
