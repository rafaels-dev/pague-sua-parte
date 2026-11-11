import type { Db, ObjectId } from "mongodb";
import type { Balance } from "./shares";

/**
 * Saldos de `uid` por grupo, em UMA agregação. Mesma conta de `balanceOf` (shares.ts):
 * due = max(0, amount - paid), refund = max(0, paid - amount); a cota de quem pagou é ignorada.
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

export async function getBalancesByGroup(db: Db, uid: string, groupIds: ObjectId[]): Promise<Map<string, Balance>> {
	const out = new Map<string, Balance>();
	if (groupIds.length === 0) return out;

	const due = { $max: [0, { $subtract: ["$shares.amountCents", PAID] }] };
	const refund = { $max: [0, { $subtract: [PAID, "$shares.amountCents"] }] };
	const isOwner = { $eq: ["$paidBy", uid] };
	const isMine = { $eq: ["$shares.uid", uid] };
	const otherShare = { $ne: ["$shares.uid", "$paidBy"] };

	const rows = await db
		.collection("expenses")
		.aggregate<{ _id: ObjectId; toPay: number; toReceive: number }>([
			{ $match: { groupId: { $in: groupIds }, $or: [{ paidBy: uid }, { "shares.uid": uid }] } },
			{ $unwind: "$shares" },
			{ $match: { $expr: otherShare } },
			{
				$group: {
					_id: "$groupId",
					toPay: {
						$sum: {
							$cond: [isOwner, refund, { $cond: [isMine, due, 0] }],
						},
					},
					toReceive: {
						$sum: {
							$cond: [isOwner, due, { $cond: [isMine, refund, 0] }],
						},
					},
				},
			},
		])
		.toArray();
	for (const r of rows) out.set(r._id.toHexString(), { toPayCents: r.toPay, toReceiveCents: r.toReceive });
	return out;
}

/**
 * Saldos de VÁRIAS pessoas por (grupo, pessoa) em UMA agregação. Cada cota (que não é a de quem pagou)
 * rende até duas linhas: ao dono (se estiver em `uids`) e a quem deve (se estiver em `uids`).
 * Chave do mapa: `${groupId}:${uid}`.
 */
export async function getBalancesForUids(db: Db, uids: string[], groupIds: ObjectId[]): Promise<Map<string, Balance>> {
	const out = new Map<string, Balance>();
	if (groupIds.length === 0 || uids.length === 0) return out;
	const due = { $max: [0, { $subtract: ["$shares.amountCents", PAID] }] };
	const refund = { $max: [0, { $subtract: [PAID, "$shares.amountCents"] }] };
	const rows = await db
		.collection("expenses")
		.aggregate<{ _id: { g: ObjectId; u: string }; toPay: number; toReceive: number }>([
			{ $match: { groupId: { $in: groupIds }, $or: [{ paidBy: { $in: uids } }, { "shares.uid": { $in: uids } }] } },
			{ $unwind: "$shares" },
			{ $match: { $expr: { $ne: ["$shares.uid", "$paidBy"] } } },
			{
				$set: {
					c: {
						$filter: {
							input: [
								{ u: "$paidBy", toPay: refund, toReceive: due },
								{ u: "$shares.uid", toPay: due, toReceive: refund },
							],
							as: "c",
							cond: { $in: ["$$c.u", { $literal: uids }] },
						},
					},
				},
			},
			{ $unwind: "$c" },
			{ $group: { _id: { g: "$groupId", u: "$c.u" }, toPay: { $sum: "$c.toPay" }, toReceive: { $sum: "$c.toReceive" } } },
		])
		.toArray();
	for (const r of rows) out.set(`${r._id.g.toHexString()}:${r._id.u}`, { toPayCents: r.toPay, toReceiveCents: r.toReceive });
	return out;
}

export const ZERO_BALANCE: Balance = { toReceiveCents: 0, toPayCents: 0 };

export function sumBalances(balances: Iterable<Balance>): Balance {
	let toReceiveCents = 0;
	let toPayCents = 0;
	for (const b of balances) {
		toReceiveCents += b.toReceiveCents;
		toPayCents += b.toPayCents;
	}
	return { toReceiveCents, toPayCents };
}
