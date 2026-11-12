import { actsFor } from "@/lib/groups/helpers";
import type { GroupDoc } from "@/lib/groups/repo";
import { isDueNow, isPastDue } from "@/lib/expenses/dates";
import { directory, type ExpenseDoc, type PersonDoc } from "@/lib/expenses/repo";
import { dueCents, normalizeShares, refundCents } from "@/lib/expenses/shares";

/** Teto de itens em GET /api/me/receivables (mesmo teto de /api/me/payables). */
export const RECEIVABLES_MAX_ITEMS = 200;

export type ReceivableItem = {
	/** "refund" = a receber de volta: a pessoa pagou a mais e quem pagou a despesa vai devolver. */
	kind: "share" | "refund";
	groupId: string;
	groupName: string;
	expenseId: string;
	description: string;
	dueCents: number;
	dueDate: string | null;
	overdue: boolean;
	installment: { number: number; count: number } | null;
	recurrence: boolean;
	/** O dinheiro vai para você (false = vai para uma pessoa sem celular que você cuida). */
	payeeIsYou: boolean;
	payeeName: string;
};

export type Debtor = {
	uid: string;
	name: string;
	picture: string | null;
	kind: "user" | "managed";
	/** Quem cuida dela, quando é uma pessoa sem celular. */
	managedByName: string | null;
	/** Você é quem cuida dela. */
	youManage: boolean;
	totalCents: number;
	overdueCents: number;
	items: ReceivableItem[];
};

export type Receivables = {
	debtors: Debtor[];
	/** Tudo o que devem a você e a quem você cuida (os itens listados). */
	totalCents: number;
	/** Parte do total sem vencimento ou vencendo até o fim do mês (a mesma regra de "agora" do resumo). */
	nowCents: number;
	/** Parte do total que vai para pessoas sem celular que você cuida (não entra no "a receber" do início). */
	managedCents: number;
	truncated: boolean;
	/** Só quando o pedido foi restrito a um grupo (`?groupId=`): o nome para a tela dizer "Só do grupo …". */
	group?: { id: string; name: string };
};

export const EMPTY_RECEIVABLES: Receivables = { debtors: [], totalCents: 0, nowCents: 0, managedCents: 0, truncated: false };

/**
 * Tudo o que ainda devem a `uid`, por devedor. Entra a cota PENDENTE (deve > 0) de qualquer pessoa, em despesas pagas por
 * quem `uid` age (ele mesmo ou quem ele cuida). Sem filtro de vencimento: é o "a receber" completo do resumo. Também entram
 * as devoluções que lhe são devidas ("A receber de volta", `kind: "refund"`); o que `uid` deve devolver não entra. Itens: vencimento (vencidos primeiro, sem data por último) e descrição;
 * devedores: total decrescente. Passando de `max` itens, ficam os primeiros nessa ordem (`truncated`).
 */
export function buildReceivables(args: {
	uid: string;
	today: string;
	groups: Pick<GroupDoc, "_id" | "name" | "members">[];
	expenses: ExpenseDoc[];
	/** Despesas (de qualquer pagador) em que `uid` ou quem ele cuida tem devolução a receber. */
	refundExpenses?: ExpenseDoc[];
	people: Map<string, PersonDoc>;
	max?: number;
}): Receivables {
	const { uid, today, groups, expenses, people } = args;
	const max = args.max ?? RECEIVABLES_MAX_ITEMS;
	const byGroup = new Map(groups.map((g) => [g._id.toHexString(), g]));
	type Row = { item: ReceivableItem; shareUid: string; group: Pick<GroupDoc, "_id" | "name" | "members"> };
	const rows: Row[] = [];
	for (const e of expenses) {
		const group = byGroup.get(e.groupId.toHexString());
		if (!group || !actsFor(group.members, uid, e.paidBy)) continue;
		const dir = directory(group as GroupDoc, people, uid);
		for (const s of normalizeShares(e.shares)) {
			const due = dueCents(s, e.paidBy);
			if (due <= 0 || s.uid === uid) continue;
			rows.push({
				shareUid: s.uid,
				group,
				item: {
					kind: "share",
					groupId: group._id.toHexString(),
					groupName: group.name,
					expenseId: e._id.toHexString(),
					description: e.description,
					dueCents: due,
					dueDate: e.dueDate ?? null,
					overdue: isPastDue(e.dueDate, today),
					installment: e.installment ? { number: e.installment.number, count: e.installment.count } : null,
					recurrence: Boolean(e.recurrence),
					payeeIsYou: e.paidBy === uid,
					payeeName: dir.name(e.paidBy),
				},
			});
		}
	}
	// A receber de volta: a pessoa (ou quem ela cuida) pagou a mais; o devedor é quem pagou a despesa.
	for (const e of args.refundExpenses ?? []) {
		const group = byGroup.get(e.groupId.toHexString());
		if (!group) continue;
		const dir = directory(group as GroupDoc, people, uid);
		for (const s of normalizeShares(e.shares)) {
			const back = refundCents(s, e.paidBy);
			// Devolver para si mesmo ou entre pessoas da mesma casa (você e quem você cuida) não é "quem me deve".
			// O que M, que você cuida, deve a VOCÊ entra (é o "a receber" do início); o que você paga a M, não.
			if (back <= 0 || !actsFor(group.members, uid, s.uid) || e.paidBy === uid || (actsFor(group.members, uid, e.paidBy) && s.uid !== uid)) continue;
			rows.push({
				shareUid: e.paidBy,
				group,
				item: {
					kind: "refund",
					groupId: group._id.toHexString(),
					groupName: group.name,
					expenseId: e._id.toHexString(),
					description: e.description,
					dueCents: back,
					dueDate: null,
					overdue: false,
					installment: e.installment ? { number: e.installment.number, count: e.installment.count } : null,
					recurrence: Boolean(e.recurrence),
					payeeIsYou: s.uid === uid,
					payeeName: dir.name(s.uid),
				},
			});
		}
	}
	rows.sort(
		(a, b) =>
			(a.item.dueDate ?? "￿").localeCompare(b.item.dueDate ?? "￿") ||
			a.item.description.localeCompare(b.item.description, "pt-BR") ||
			a.item.expenseId.localeCompare(b.item.expenseId) ||
			a.shareUid.localeCompare(b.shareUid),
	);
	const truncated = rows.length > max;
	const byDebtor = new Map<string, Debtor>();
	let totalCents = 0;
	let nowCents = 0;
	let managedCents = 0;
	for (const { item, shareUid, group } of rows.slice(0, max)) {
		let d = byDebtor.get(shareUid);
		if (!d) {
			const dir = directory(group as GroupDoc, people, uid);
			const kind = dir.kind(shareUid);
			d = {
				uid: shareUid,
				name: dir.name(shareUid),
				picture: dir.picture(shareUid),
				kind,
				managedByName: kind === "managed" ? dir.managedByName(shareUid) : null,
				youManage: dir.youManage(shareUid),
				totalCents: 0,
				overdueCents: 0,
				items: [],
			};
			byDebtor.set(shareUid, d);
		}
		d.items.push(item);
		d.totalCents += item.dueCents;
		if (item.overdue) d.overdueCents += item.dueCents;
		totalCents += item.dueCents;
		if (isDueNow(item.dueDate, today)) nowCents += item.dueCents;
		if (!item.payeeIsYou) managedCents += item.dueCents;
	}
	const debtors = [...byDebtor.values()].sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "pt-BR") || a.uid.localeCompare(b.uid));
	return { debtors, totalCents, nowCents, managedCents, truncated };
}
