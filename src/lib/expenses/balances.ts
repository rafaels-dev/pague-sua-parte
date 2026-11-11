import type { Db, ObjectId } from "mongodb";
import type { Balance } from "./shares";

/**
 * Saldos de `uid` por grupo, em UMA agregação. Mesma conta de `balanceOf` (shares.ts):
 * due = max(0, amount - paid), refund = max(0, paid - amount); a cota de quem pagou é ignorada.
 * Não importa repo.ts (o repo de grupos importa este módulo).
 */
export async function getBalancesByGroup(db: Db, uid: string, groupIds: ObjectId[]): Promise<Map<string, Balance>> {
	const out = new Map<string, Balance>();
	if (groupIds.length === 0) return out;

	const due = { $max: [0, { $subtract: ["$shares.amountCents", "$shares.paidCents"] }] };
	const refund = { $max: [0, { $subtract: ["$shares.paidCents", "$shares.amountCents"] }] };
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
