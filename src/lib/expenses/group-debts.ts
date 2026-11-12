import { isPastDue } from "./dates";
import { dueCents, normalizeShares, refundCents, type ExpenseShare } from "./shares";

/**
 * Quanto `fromUid` ainda deve a `toUid` no grupo, já descontado o que `toUid` deve de volta em dívidas do mesmo tipo.
 * `kind: "refund"` = devolução (quem pagou a despesa devolve o que a pessoa pagou a mais); fica separada das partes a pagar.
 */
export type Debt = { fromUid: string; toUid: string; cents: number; overdueCents: number; kind: "share" | "refund" };

type Row = { paidBy: string; shares: ExpenseShare[]; dueDate?: string | null };

/**
 * Quem deve quanto a quem em um grupo (só o que está em aberto): cada cota pendente é uma dívida da pessoa com
 * quem pagou; cada reembolso é uma dívida de quem pagou com a pessoa. Dívidas de sentidos opostos entre a mesma
 * dupla se compensam, e o que sobra vem com a parte vencida (despesa com vencimento antes de `today`; reembolso
 * nunca está vencido). Ordem: com vencido primeiro, depois maior valor, depois pelos códigos (estável).
 */
export function groupDebts(expenses: Row[], today: string): Debt[] {
	const gross = new Map<string, { cents: number; overdueCents: number }>();
	const add = (from: string, to: string, cents: number, late: boolean, kind: Debt["kind"]) => {
		if (cents <= 0) return;
		const k = `${kind}\u0000${from}\u0000${to}`;
		const cur = gross.get(k) ?? { cents: 0, overdueCents: 0 };
		cur.cents += cents;
		if (late) cur.overdueCents += cents;
		gross.set(k, cur);
	};
	for (const e of expenses) {
		const late = isPastDue(e.dueDate ?? undefined, today);
		for (const s of normalizeShares(e.shares)) {
			if (s.uid === e.paidBy) continue;
			add(s.uid, e.paidBy, dueCents(s, e.paidBy), late, "share");
			add(e.paidBy, s.uid, refundCents(s, e.paidBy), false, "refund");
		}
	}
	const out: Debt[] = [];
	for (const [k, v] of gross) {
		const [kind, from, to] = k.split("\u0000") as [Debt["kind"], string, string];
		const back = gross.get(`${kind}\u0000${to}\u0000${from}`)?.cents ?? 0;
		const net = v.cents - back;
		if (net > 0) out.push({ fromUid: from, toUid: to, cents: net, overdueCents: Math.min(net, v.overdueCents), kind });
	}
	return out.sort(
		(a, b) =>
			Number(b.overdueCents > 0) - Number(a.overdueCents > 0) ||
			b.cents - a.cents ||
			a.fromUid.localeCompare(b.fromUid) ||
			a.toUid.localeCompare(b.toUid),
	);
}
