import { formatBRL } from "@/lib/money";

type PersonAmount = { name: string; cents: number };
export type SummaryExpense = {
	/** Código da despesa; não aparece no texto. */
	id: string;
	description: string;
	totalCents: number;
	paidByName: string;
	/** Só quando importa (venceu, ou vence nos próximos 15 dias), YYYY-MM-DD. */
	dueDate: string | null;
	overdue: boolean;
	owes: PersonAmount[];
	moreOwes: number;
	refunds: PersonAmount[];
	moreRefunds: number;
};
export type SummaryUpcoming = { id: string; dueDate: string; description: string; paidByName: string; owes: PersonAmount[]; moreOwes: number };

/** Resumo do grupo inteiro para o WhatsApp (formato de `GET /api/groups/:id/summary`). Só nomes: nunca chave Pix. */
export type GroupSummaryData = {
	groupName: string;
	totalOpenCents: number;
	overdueCents: number;
	debts: { fromName: string; toName: string; cents: number; overdue: boolean; refund: boolean }[];
	moreDebts: number;
	upToDate: string[];
	moreUpToDate: number;
	/** Despesas em aberto demais: os valores estão incompletos e "quem está em dia" não é confiável. */
	partial?: boolean;
	/** Despesas com algo em aberto, as mais urgentes primeiro. */
	expenses: SummaryExpense[];
	moreExpenses: number;
	/** Partes a pagar de hoje até daqui a 15 dias, por vencimento. */
	upcoming: SummaryUpcoming[];
	moreUpcoming: number;
	upcomingTotalCents: number;
};

/** Quantas linhas de "quem deve" cabem na mensagem (o resto vira "e mais N"). */
export const SUMMARY_MAX_LINES = 20;
const MAX_NAMES = 12;
/** Despesas, pagamentos do período e pessoas por linha que cabem no texto (o resto vira "e mais N"). */
export const SUMMARY_MAX_EXPENSES = 15;
export const SUMMARY_MAX_UPCOMING = 12;
const MAX_PEOPLE = 6;
/** Tamanho confortável para o link `wa.me/?text=`: passou disso, corta primeiro as despesas, depois os pagamentos do período. */
export const SUMMARY_MAX_CHARS = 3500;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Aceita a resposta da API; o que faltar vira vazio, para a tela nunca quebrar. */
const people = (v: unknown): PersonAmount[] =>
	(Array.isArray(v) ? v : []).flatMap((p) => {
		if (!p || typeof p !== "object") return [];
		const x = p as Record<string, unknown>;
		return num(x.cents) > 0 ? [{ name: str(x.name, "Participante"), cents: num(x.cents) }] : [];
	});
const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function normalizeGroupSummary(raw: unknown): GroupSummaryData {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const debts = (Array.isArray(r.debts) ? r.debts : []).flatMap((d) => {
		if (!d || typeof d !== "object") return [];
		const x = d as Record<string, unknown>;
		const cents = num(x.cents);
		return cents > 0 ? [{ fromName: str(x.fromName, "Participante"), toName: str(x.toName, "Participante"), cents, overdue: x.overdue === true, refund: x.refund === true }] : [];
	});
	return {
		groupName: str(r.groupName, "Grupo"),
		totalOpenCents: num(r.totalOpenCents),
		overdueCents: num(r.overdueCents),
		debts,
		moreDebts: Math.max(0, num(r.moreDebts)),
		upToDate: (Array.isArray(r.upToDate) ? r.upToDate : []).filter((n): n is string => typeof n === "string"),
		moreUpToDate: Math.max(0, num(r.moreUpToDate)),
		partial: r.partial === true,
		expenses: (Array.isArray(r.expenses) ? r.expenses : []).flatMap((e) => {
			if (!e || typeof e !== "object") return [];
			const x = e as Record<string, unknown>;
			const owes = people(x.owes);
			const refunds = people(x.refunds);
			if (owes.length === 0 && refunds.length === 0) return [];
			return [{ id: str(x.id), description: str(x.description, "Despesa"), totalCents: num(x.totalCents), paidByName: str(x.paidByName, "Participante"), dueDate: dateOrNull(x.dueDate), overdue: x.overdue === true, owes, moreOwes: Math.max(0, num(x.moreOwes)), refunds, moreRefunds: Math.max(0, num(x.moreRefunds)) }];
		}),
		moreExpenses: Math.max(0, num(r.moreExpenses)),
		upcoming: (Array.isArray(r.upcoming) ? r.upcoming : []).flatMap((e) => {
			if (!e || typeof e !== "object") return [];
			const x = e as Record<string, unknown>;
			const owes = people(x.owes);
			const dueDate = dateOrNull(x.dueDate);
			return dueDate && owes.length > 0 ? [{ id: str(x.id), dueDate, description: str(x.description, "Despesa"), paidByName: str(x.paidByName, "Participante"), owes, moreOwes: Math.max(0, num(x.moreOwes)) }] : [];
		}),
		moreUpcoming: Math.max(0, num(r.moreUpcoming)),
		upcomingTotalCents: num(r.upcomingTotalCents),
	};
}

function nameList(names: string[], more: number): string {
	const shown = names.slice(0, MAX_NAMES);
	const rest = names.length - shown.length + more;
	const items = rest > 0 ? [...shown, `mais ${rest}`] : shown;
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const peopleText = (list: PersonAmount[], more: number, join: (p: PersonAmount) => string) => {
	const shown = list.slice(0, MAX_PEOPLE).map(join);
	const rest = list.length - shown.length + more;
	return rest > 0 ? `${shown.join(", ")} e mais ${rest}` : shown.join(", ");
};

/**
 * Mensagem do resumo do grupo, igual para quem compartilhar (não é o saldo de quem manda).
 * Linhas curtas, `*negrito*` só nos títulos e no total; valores em reais; só nomes e valores (nunca chave Pix).
 * Ordem: totais, pagamentos dos próximos 15 dias, despesas em aberto, quem deve a quem, quem está em dia.
 * Texto grande demais para o WhatsApp: corta primeiro as despesas, depois os pagamentos do período (e diz quantos ficaram de fora);
 * os totais nunca saem. Passou de `maxLines` linhas de dívida: "e mais N".
 */
export function buildGroupSummaryText(s: GroupSummaryData, link: string, maxLines = SUMMARY_MAX_LINES): string {
	const name = s.groupName.trim() || "Grupo";
	const PARTIAL = "Atenção: resumo incompleto (são muitas despesas em aberto). Veja tudo no app.";
	if (!s.partial && (s.totalOpenCents <= 0 || s.debts.length === 0) && s.expenses.length === 0 && s.upcoming.length === 0) {
		const all = nameList(s.upToDate, s.moreUpToDate);
		return [`*Resumo do grupo ${name}*`, "Tudo certo: ninguém deve nada.", ...(all ? [`Em dia: ${all}`] : []), "", `Veja os detalhes: ${link}`].join("\n");
	}
	// Por pessoa (ordem alfabética), partes a pagar antes das devoluções, maiores valores primeiro.
	const sorted = [...s.debts].sort(
		(a, b) => a.fromName.localeCompare(b.fromName, "pt-BR") || Number(a.refund) - Number(b.refund) || b.cents - a.cents || a.toName.localeCompare(b.toName, "pt-BR"),
	);
	const line = (d: GroupSummaryData["debts"][number]) =>
		d.refund ? `${d.fromName} devolve ${formatBRL(d.cents)} para ${d.toName}` : `${d.fromName} deve ${formatBRL(d.cents)} a ${d.toName}${d.overdue ? " (atrasado)" : ""}`;

	const render = (nExp: number, nUp: number, debtLines: number): string => {
		const lines = [`*Resumo do grupo ${name}*`, `${s.partial ? "Em aberto (parcial)" : "Ainda em aberto"}: *${formatBRL(s.totalOpenCents)}*`];
		if (s.overdueCents > 0) lines.push(`Atrasado: ${formatBRL(s.overdueCents)}`);

		const ups = s.upcoming.slice(0, nUp);
		const exps = s.expenses.slice(0, nExp);
		const hiddenUp = s.upcoming.length - ups.length + s.moreUpcoming;
		const hiddenExp = s.expenses.length - exps.length + s.moreExpenses;
		// Seção que ficou sem nenhuma linha não imprime título: só uma linha avisando quanto ficou de fora.
		const omitted: string[] = [];
		if (s.upcoming.length > 0 && ups.length === 0) omitted.push(`${hiddenUp} ${hiddenUp === 1 ? "pagamento" : "pagamentos"} dos próximos 15 dias`);
		if (s.expenses.length > 0 && exps.length === 0) omitted.push(`${hiddenExp} ${hiddenExp === 1 ? "despesa em aberto" : "despesas em aberto"}`);
		if (omitted.length > 0) lines.push(`Não coube aqui: ${omitted.join(" e ")}. Veja no app.`);

		if (ups.length > 0) {
			lines.push("", `*Pagamentos para os próximos 15 dias:* ${formatBRL(s.upcomingTotalCents)}`);
			for (const u of ups) lines.push(`${ddmm(u.dueDate)} — ${u.description}: ${peopleText(u.owes, u.moreOwes, (p) => `${formatBRL(p.cents)} de ${p.name}`)} (para ${u.paidByName})`);
			if (hiddenUp > 0) lines.push(`e mais ${hiddenUp} ${hiddenUp === 1 ? "pagamento" : "pagamentos"}`);
		}

		if (exps.length > 0) {
			// Quem já está na lista de cima (mesmo código) não repete quem deve quanto.
			const listed = new Set(ups.map((u) => u.id).filter(Boolean));
			lines.push("", "*Despesas em aberto*");
			for (const e of exps) {
				const due = e.dueDate ? ` (${e.overdue ? "venceu" : "vence"} em ${ddmm(e.dueDate)})` : "";
				lines.push(`• ${e.description} — ${formatBRL(e.totalCents)}, pago por ${e.paidByName}${due}`);
				if (e.owes.length > 0) {
					const compact = e.moreOwes === 0 && !e.overdue && e.id !== "" && listed.has(e.id);
					lines.push(compact ? `  Falta: ${formatBRL(e.owes.reduce((t, x) => t + x.cents, 0))} (veja acima)` : `  Falta: ${peopleText(e.owes, e.moreOwes, (p) => `${formatBRL(p.cents)} de ${p.name}`)}`);
				}
				if (e.refunds.length > 0) lines.push(`  Devolver: ${peopleText(e.refunds, e.moreRefunds, (p) => `${formatBRL(p.cents)} para ${p.name}`)}`);
			}
			if (hiddenExp > 0) lines.push(`e mais ${hiddenExp} ${hiddenExp === 1 ? "despesa" : "despesas"}`);
		}

		const shown = sorted.slice(0, debtLines).map(line);
		const hidden = sorted.length - shown.length + s.moreDebts;
		lines.push("");
		if (shown.length > 0 && (s.expenses.length > 0 || s.upcoming.length > 0)) lines.push("*Quem deve a quem*");
		lines.push(...shown);
		if (shown.length > 0 && hidden > 0) lines.push(`e mais ${hidden}`);
		// Com o resumo incompleto, não dá para afirmar quem está em dia: a linha some.
		const all = s.partial ? "" : nameList(s.upToDate, s.moreUpToDate);
		if (all) lines.push("", `Em dia: ${all}`);
		if (s.partial) lines.push("", PARTIAL);
		lines.push("", `Veja os detalhes: ${link}`);
		return lines.join("\n");
	};

	let nExp = Math.min(s.expenses.length, SUMMARY_MAX_EXPENSES);
	let nUp = Math.min(s.upcoming.length, SUMMARY_MAX_UPCOMING);
	let debtLines = maxLines;
	let text = render(nExp, nUp, debtLines);
	// Grande demais: tira uma despesa por vez, depois um pagamento do período por vez, por fim linhas de "quem deve a quem".
	while (text.length > SUMMARY_MAX_CHARS && (nExp > 0 || nUp > 0 || debtLines > 3)) {
		if (nExp > 0) nExp--;
		else if (nUp > 0) nUp--;
		else debtLines--;
		text = render(nExp, nUp, debtLines);
	}
	return text;
}

/** Endereço da página do grupo, para mandar no resumo. */
export function buildGroupLink(origin: string, groupId: string): string {
	return `${origin.replace(/\/+$/, "")}/app/grupos/${encodeURIComponent(groupId)}`;
}
