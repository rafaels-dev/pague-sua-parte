import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/db/client";
import { isManagedUid } from "@/lib/groups/helpers";
import type { GroupDoc } from "@/lib/groups/repo";
import { usersCollection } from "@/lib/users/repo";
import { buildMemberJoinedNotices, buildNewExpenseNotices, buildPaymentNotices } from "./messages";
import { notify } from "./notify";
import { runAfterResponse } from "./schedule";
import type { GroupInfo, NewExpenseFact, NewExpenseMode, NoticeContext, PaymentFact } from "./types";

type GroupRow = Pick<GroupDoc, "_id" | "name" | "members">;

/** Carrega os grupos e os nomes das pessoas necessárias (sem e-mail, chave Pix nem outros dados). */
async function loadContext(db: Db, groupIds: string[], extraUids: string[]): Promise<NoticeContext & { groups: Map<string, GroupRow> }> {
	const ids = [...new Set(groupIds)].filter((g) => ObjectId.isValid(g));
	const rows = ids.length
		? await db.collection<GroupDoc>("groups").find({ _id: { $in: ids.map((g) => new ObjectId(g)) } }, { projection: { name: 1, members: 1 } }).toArray()
		: [];
	const groups = new Map(rows.map((g) => [g._id.toHexString(), g as GroupRow]));
	const uids = new Set(extraUids);
	for (const g of rows) for (const m of g.members) uids.add(m.uid);
	const real = [...uids].filter((u) => !isManagedUid(u));
	const people = new Map(
		(real.length
			? await usersCollection(db).find({ _id: { $in: real } }, { projection: { name: 1, displayName: 1 } }).toArray()
			: []
		).map((u) => [u._id, u.displayName?.trim() || u.name]),
	);
	return {
		groups,
		group: (id): GroupInfo | undefined => groups.get(id),
		name: (groupId, uid) => {
			const m = groups.get(groupId)?.members.find((x) => x.uid === uid);
			if (m?.kind === "managed") return m.name?.trim() || "Alguém";
			return people.get(uid) || "Alguém";
		},
	};
}

export async function notifyMemberJoined(db: Db, groupId: string, joinerUid: string): Promise<void> {
	const ctx = await loadContext(db, [groupId], [joinerUid]);
	const g = ctx.groups.get(groupId);
	if (!g) return;
	await notify(db, buildMemberJoinedNotices({ groupId, groupName: g.name, members: g.members, joinerUid, joinerName: ctx.name(groupId, joinerUid) }));
}

export async function notifyPayments(db: Db, facts: PaymentFact[]): Promise<void> {
	if (facts.length === 0) return;
	const ctx = await loadContext(db, facts.map((f) => f.groupId), facts.flatMap((f) => [f.actorUid, f.paidBy, f.debtorUid]));
	await notify(db, buildPaymentNotices(facts, ctx));
}

export async function notifyNewExpenses(db: Db, facts: NewExpenseFact[], mode: NewExpenseMode): Promise<void> {
	if (facts.length === 0) return;
	const ctx = await loadContext(db, facts.map((f) => f.groupId), facts.flatMap((f) => [f.paidBy, ...(f.actorUid ? [f.actorUid] : []), ...f.shares.map((s) => s.uid)]));
	await notify(db, facts.flatMap((f) => buildNewExpenseNotices(f, mode, ctx)));
}

// Atalhos para as rotas e repositórios: tudo depois da resposta e sem depender de nada que a rota já tenha; o banco é obtido
// dentro do `after`, então uma falha aqui nunca vira erro para uma ação já gravada.
export const afterMemberJoined = (groupId: string, joinerUid: string) => runAfterResponse(async () => notifyMemberJoined(await getDb(), groupId, joinerUid));
export const afterPayments = (facts: PaymentFact[] | undefined) => {
	if (facts?.length) runAfterResponse(async () => notifyPayments(await getDb(), facts));
};
export const afterNewExpenses = (facts: NewExpenseFact[] | undefined, mode: NewExpenseMode) => {
	if (facts?.length) runAfterResponse(async () => notifyNewExpenses(await getDb(), facts, mode));
};
