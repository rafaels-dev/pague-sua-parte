import { createHash } from "node:crypto";
import { actsFor } from "@/lib/groups/helpers";
import type { GroupDoc } from "@/lib/groups/repo";
import { isDueNow, isPastDue } from "@/lib/expenses/dates";
import { directory, type ExpenseDoc, type PersonDoc } from "@/lib/expenses/repo";
import { dueCents, normalizeShares } from "@/lib/expenses/shares";

/** Teto de itens em GET /api/me/payables (uma família não chega perto disso). */
export const PAYABLES_MAX_ITEMS = 200;

export type PayableItem = {
	groupId: string;
	groupName: string;
	expenseId: string;
	description: string;
	shareUid: string;
	shareName: string;
	isYou: boolean;
	dueCents: number;
	dueDate: string | null;
	overdue: boolean;
	installment: { number: number; count: number } | null;
	recurrence: boolean;
};

export type PayableRecipient = {
	id: string;
	payee: { uid: string; name: string; picture: string | null; kind: "user" | "managed" };
	pix: { type: string; key: string; payeeName: string };
	totalCents: number;
	items: PayableItem[];
};

/** `group` só vem quando o pedido foi restrito a um grupo (`?groupId=`): o nome para a tela dizer "Só do grupo …". */
export type Payables = { recipients: PayableRecipient[]; truncated: boolean; group?: { id: string; name: string } };

/** Um Pix só paga uma chave: o destinatário é quem pagou a despesa + a chave Pix gravada nela. */
export const recipientKey = (e: { paidBy: string; pix: { type: string; key: string } }): string =>
	`${e.paidBy}\n${e.pix.type}\n${e.pix.key}`;

/** Id estável do destinatário, seguro para chave do React/URL, sem expor a chave Pix. */
export const recipientId = (e: { paidBy: string; pix: { type: string; key: string } }): string =>
	`r_${createHash("sha256").update(recipientKey(e)).digest("hex").slice(0, 24)}`;

/**
 * Tudo o que `uid` pode pagar agora, por destinatário. Entra a cota PENDENTE (deve > 0) de quem `uid` age (ele mesmo
 * ou quem ele cuida) em despesas "a pagar agora": sem vencimento ou vencendo até o fim do mês de hoje (inclui atrasadas),
 * a mesma regra de `toPayNowCents` do resumo. Ordem dos itens: vencimento (sem data por último) e descrição; dos
 * destinatários: total decrescente. Passando de `max` itens, ficam os primeiros nessa ordem (`truncated`).
 */
export function buildPayables(args: {
	uid: string;
	today: string;
	groups: Pick<GroupDoc, "_id" | "name" | "members">[];
	expenses: ExpenseDoc[];
	people: Map<string, PersonDoc>;
	max?: number;
}): Payables {
	const { uid, today, groups, expenses, people } = args;
	const max = args.max ?? PAYABLES_MAX_ITEMS;
	const byGroup = new Map(groups.map((g) => [g._id.toHexString(), g]));
	type Row = { item: PayableItem; e: ExpenseDoc; group: Pick<GroupDoc, "_id" | "name" | "members"> };
	const rows: Row[] = [];
	for (const e of expenses) {
		const group = byGroup.get(e.groupId.toHexString());
		if (!group || !isDueNow(e.dueDate, today)) continue;
		const dir = directory(group as GroupDoc, people, uid);
		for (const s of normalizeShares(e.shares)) {
			const due = dueCents(s, e.paidBy);
			if (due <= 0 || !actsFor(group.members, uid, s.uid)) continue;
			rows.push({
				e,
				group,
				item: {
					groupId: group._id.toHexString(),
					groupName: group.name,
					expenseId: e._id.toHexString(),
					description: e.description,
					shareUid: s.uid,
					shareName: dir.name(s.uid),
					isYou: s.uid === uid,
					dueCents: due,
					dueDate: e.dueDate ?? null,
					overdue: isPastDue(e.dueDate, today),
					installment: e.installment ? { number: e.installment.number, count: e.installment.count } : null,
					recurrence: Boolean(e.recurrence),
				},
			});
		}
	}
	rows.sort(
		(a, b) =>
			(a.item.dueDate ?? "￿").localeCompare(b.item.dueDate ?? "￿") ||
			a.item.description.localeCompare(b.item.description, "pt-BR") ||
			a.item.expenseId.localeCompare(b.item.expenseId) ||
			a.item.shareUid.localeCompare(b.item.shareUid),
	);
	const truncated = rows.length > max;
	const byRecipient = new Map<string, PayableRecipient>();
	for (const { item, e, group } of rows.slice(0, max)) {
		const id = recipientId(e);
		let r = byRecipient.get(id);
		if (!r) {
			const dir = directory(group as GroupDoc, people, uid);
			r = {
				id,
				payee: { uid: e.paidBy, name: dir.name(e.paidBy), picture: dir.picture(e.paidBy), kind: dir.kind(e.paidBy) },
				pix: { type: e.pix.type, key: e.pix.key, payeeName: e.pix.payeeName },
				totalCents: 0,
				items: [],
			};
			byRecipient.set(id, r);
		}
		r.items.push(item);
		r.totalCents += item.dueCents;
	}
	const recipients = [...byRecipient.values()].sort((a, b) => b.totalCents - a.totalCents || a.payee.name.localeCompare(b.payee.name, "pt-BR") || a.id.localeCompare(b.id));
	return { recipients, truncated };
}
