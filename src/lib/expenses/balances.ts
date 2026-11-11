import type { Db, ObjectId } from "mongodb";
import { lastDayOfMonth, todayInSaoPaulo } from "./dates";
import type { Balance } from "./shares";

/**
 * Saldos de `uid` por grupo, em UMA agregação. Mesma conta de `balanceOf` (shares.ts):
 * due = max(0, amount - paid), refund = max(0, paid - amount); a cota de quem pagou é ignorada.
 * "Agora" = despesa sem `dueDate` ou com `dueDate` até o último dia do mês atual (São Paulo); reembolso sempre é "agora".
 * "Atrasado" = o que `uid` deve em despesas com `dueDate` antes de hoje.
 * Não importa repo.ts (o repo de grupos importa este módulo).
 */
/** paidCents com leitura do modelo antigo: sem número, `status: 'paid'` vale a cota inteira. */
const PAID = {
	$cond: [
		{ $isNumber: "$shares.paidCents" },
		"$shares.paidCents",
		{ $cond: [{ $eq: ["$shares.status", "paid"] }, "$shares.amountCents", 0] },
	],
};

function amounts(now: Date) {
	const today = todayInSaoPaulo(now);
	const cutoff = lastDayOfMonth(today);
	const dd = { $ifNull: ["$dueDate", ""] };
	const due = { $max: [0, { $subtract: ["$shares.amountCents", PAID] }] };
	const refund = { $max: [0, { $subtract: [PAID, "$shares.amountCents"] }] };
	return {
		due,
		refund,
		dueNow: { $cond: [{ $lte: [dd, cutoff] }, due, 0] },
		dueLate: { $cond: [{ $and: [{ $gt: [dd, ""] }, { $lt: [dd, today] }] }, due, 0] },
	};
}

const toBalance = (r: { toPay: number; toReceive: number; toPayNow: number; toReceiveNow: number; overdue: number }): Balance => ({
	toPayCents: r.toPay,
	toReceiveCents: r.toReceive,
	toPayNowCents: r.toPayNow,
	toReceiveNowCents: r.toReceiveNow,
	overdueToPayCents: r.overdue,
});

type Row = { toPay: number; toReceive: number; toPayNow: number; toReceiveNow: number; overdue: number };

export async function getBalancesByGroup(db: Db, uid: string, groupIds: ObjectId[], now: Date = new Date()): Promise<Map<string, Balance>> {
	const out = new Map<string, Balance>();
	if (groupIds.length === 0) return out;

	const { due, refund, dueNow, dueLate } = amounts(now);
	const isOwner = { $eq: ["$paidBy", uid] };
	const isMine = { $eq: ["$shares.uid", uid] };
	const otherShare = { $ne: ["$shares.uid", "$paidBy"] };
	const pick = (owner: unknown, mine: unknown) => ({ $sum: { $cond: [isOwner, owner, { $cond: [isMine, mine, 0] }] } });

	const rows = await db
		.collection("expenses")
		.aggregate<{ _id: ObjectId } & Row>([
			{ $match: { groupId: { $in: groupIds }, $or: [{ paidBy: uid }, { "shares.uid": uid }] } },
			{ $unwind: "$shares" },
			{ $match: { $expr: otherShare } },
			{
				$group: {
					_id: "$groupId",
					toPay: pick(refund, due),
					toReceive: pick(due, refund),
					toPayNow: pick(refund, dueNow),
					toReceiveNow: pick(dueNow, refund),
					overdue: pick(0, dueLate),
				},
			},
		])
		.toArray();
	for (const r of rows) out.set(r._id.toHexString(), toBalance(r));
	return out;
}

/**
 * Saldos de VÁRIAS pessoas por (grupo, pessoa) em UMA agregação. Cada cota (que não é a de quem pagou)
 * rende até duas linhas: ao dono (se estiver em `uids`) e a quem deve (se estiver em `uids`).
 * Chave do mapa: `${groupId}:${uid}`.
 */
export async function getBalancesForUids(db: Db, uids: string[], groupIds: ObjectId[], now: Date = new Date()): Promise<Map<string, Balance>> {
	const out = new Map<string, Balance>();
	if (groupIds.length === 0 || uids.length === 0) return out;
	const { due, refund, dueNow, dueLate } = amounts(now);
	const rows = await db
		.collection("expenses")
		.aggregate<{ _id: { g: ObjectId; u: string } } & Row>([
			{ $match: { groupId: { $in: groupIds }, $or: [{ paidBy: { $in: uids } }, { "shares.uid": { $in: uids } }] } },
			{ $unwind: "$shares" },
			{ $match: { $expr: { $ne: ["$shares.uid", "$paidBy"] } } },
			{
				$set: {
					c: {
						$filter: {
							input: [
								{ u: "$paidBy", toPay: refund, toReceive: due, toPayNow: refund, toReceiveNow: dueNow, overdue: 0 },
								{ u: "$shares.uid", toPay: due, toReceive: refund, toPayNow: dueNow, toReceiveNow: refund, overdue: dueLate },
							],
							as: "c",
							cond: { $in: ["$$c.u", { $literal: uids }] },
						},
					},
				},
			},
			{ $unwind: "$c" },
			{
				$group: {
					_id: { g: "$groupId", u: "$c.u" },
					toPay: { $sum: "$c.toPay" },
					toReceive: { $sum: "$c.toReceive" },
					toPayNow: { $sum: "$c.toPayNow" },
					toReceiveNow: { $sum: "$c.toReceiveNow" },
					overdue: { $sum: "$c.overdue" },
				},
			},
		])
		.toArray();
	for (const r of rows) out.set(`${r._id.g.toHexString()}:${r._id.u}`, toBalance(r));
	return out;
}

export const ZERO_BALANCE: Balance = { toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 };

export function sumBalances(balances: Iterable<Balance>): Balance {
	const sum: Balance = { ...ZERO_BALANCE };
	for (const b of balances) {
		sum.toReceiveCents += b.toReceiveCents;
		sum.toPayCents += b.toPayCents;
		sum.toReceiveNowCents += b.toReceiveNowCents;
		sum.toPayNowCents += b.toPayNowCents;
		sum.overdueToPayCents += b.overdueToPayCents;
	}
	return sum;
}
