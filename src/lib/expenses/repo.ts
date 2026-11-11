import { ObjectId, type Db } from "mongodb";
import { groupsCollection, type GroupDoc } from "@/lib/groups/repo";
import { isObjectIdHex } from "@/lib/groups/helpers";
import type { PixKey } from "@/lib/pix/key";
import {
	deleteAttachments,
	putAttachment,
	type AttachmentMeta,
	type AttachmentStore,
} from "@/lib/storage/attachments";
import { usersCollection, type UserDoc } from "@/lib/users/repo";
import { splitEqually } from "./split";
import type { ExpenseInput, SniffedFile } from "./validation";

export type ShareStatus = "payer" | "pending" | "paid";
export type ShareMethod = "manual";
export type ExpenseShare = {
	uid: string;
	amountCents: number;
	status: ShareStatus;
	/** Preenchidos só em cotas pagas: quando, por quem foi marcado e como. */
	paidAt?: Date;
	markedBy?: string;
	method?: ShareMethod;
};
export type ExpenseDoc = {
	_id: ObjectId;
	groupId: ObjectId;
	createdBy: string;
	paidBy: string;
	description: string;
	amountCents: number;
	date: string;
	pix: PixKey & { payeeName: string };
	shares: ExpenseShare[];
	attachments: AttachmentMeta[];
	createdAt: Date;
	updatedAt: Date;
};

export function expensesCollection(db: Db) {
	return db.collection<ExpenseDoc>("expenses");
}

const ATTACHMENT_ID_RE = /^[0-9a-f]{32}$/;
const personName = (u?: Pick<UserDoc, "name" | "displayName">) => u?.displayName?.trim() || u?.name || "Participante";

async function findMemberGroup(db: Db, id: string, uid: string): Promise<GroupDoc | null> {
	if (!isObjectIdHex(id)) return null;
	return groupsCollection(db).findOne({ _id: new ObjectId(id), "members.uid": uid });
}

type PersonDoc = Pick<UserDoc, "_id" | "name" | "displayName" | "picture">;

/** Projeção explícita: e-mail e chave Pix de ninguém saem do banco aqui. */
async function loadPeople(db: Db, uids: string[]): Promise<Map<string, PersonDoc>> {
	const users = await usersCollection(db)
		.find<PersonDoc>({ _id: { $in: uids } }, { projection: { name: 1, displayName: 1, picture: 1 } })
		.toArray();
	return new Map(users.map((u) => [u._id, u]));
}

// ---------- detalhe ----------

export type ExpenseDetail = {
	id: string;
	groupId: string;
	description: string;
	amountCents: number;
	date: string;
	createdAt: string;
	canDelete: boolean;
	/** Quem lançou a despesa (paidBy) pode marcar as partes dos outros como pagas. */
	canMarkPaid: boolean;
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean };
	pix: { type: string; key: string; payeeName: string };
	shares: {
		uid: string;
		name: string;
		picture: string | null;
		amountCents: number;
		status: ShareStatus;
		isYou: boolean;
		paidAt: string | null;
		method: ShareMethod | null;
	}[];
	attachments: { id: string; name: string; contentType: string; size: number }[];
};

const hasPaid = (e: Pick<ExpenseDoc, "shares">) => e.shares.some((s) => s.status === "paid");
function canDeleteExpense(e: ExpenseDoc, group: GroupDoc, uid: string) {
	const isAdmin = group.members.some((m) => m.uid === uid && m.role === "admin");
	return (e.createdBy === uid || isAdmin) && !hasPaid(e);
}

async function toDetail(db: Db, e: ExpenseDoc, group: GroupDoc, uid: string): Promise<ExpenseDetail> {
	const people = await loadPeople(db, [...new Set([e.paidBy, ...e.shares.map((s) => s.uid)])]);
	const view = (u: string) => ({
		uid: u,
		name: personName(people.get(u)),
		picture: people.get(u)?.picture ?? null,
		isYou: u === uid,
	});
	return {
		id: e._id.toHexString(),
		groupId: e.groupId.toHexString(),
		description: e.description,
		amountCents: e.amountCents,
		date: e.date,
		createdAt: e.createdAt.toISOString(),
		canDelete: canDeleteExpense(e, group, uid),
		canMarkPaid: e.paidBy === uid,
		paidBy: view(e.paidBy),
		pix: { type: e.pix.type, key: e.pix.key, payeeName: e.pix.payeeName },
		shares: e.shares.map((s) => ({
			...view(s.uid),
			amountCents: s.amountCents,
			status: s.status,
			paidAt: s.status === "paid" && s.paidAt ? new Date(s.paidAt).toISOString() : null,
			method: s.status === "paid" ? (s.method ?? null) : null,
		})),
		attachments: e.attachments.map((a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size })),
	};
}

export type GetExpenseResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" };

async function findExpense(db: Db, groupId: string, eid: string) {
	if (!isObjectIdHex(eid)) return null;
	return expensesCollection(db).findOne({ _id: new ObjectId(eid), groupId: new ObjectId(groupId) });
}

export async function getExpenseDetail(db: Db, groupId: string, eid: string, uid: string): Promise<GetExpenseResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const e = await findExpense(db, groupId, eid);
	if (!e) return { status: "no_expense" };
	return { status: "ok", expense: await toDetail(db, e, group, uid) };
}

// ---------- criação ----------

export type CreateResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_pix" }
	| { status: "invalid"; error: string; field: string };

export async function createExpense(
	db: Db,
	store: AttachmentStore,
	args: { groupId: string; uid: string; input: ExpenseInput; files: SniffedFile[] },
): Promise<CreateResult> {
	const { groupId, uid, input, files } = args;
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };

	const payer = await usersCollection(db).findOne(
		{ _id: uid },
		{ projection: { name: 1, displayName: 1, pixKey: 1 } },
	);
	if (!payer?.pixKey) return { status: "no_pix" };

	const memberUids = new Set(group.members.map((m) => m.uid));
	if (!input.participantUids.every((p) => memberUids.has(p))) {
		return { status: "invalid", field: "participantUids", error: "Escolha apenas pessoas que estão no grupo." };
	}
	if (!input.participantUids.some((p) => p !== uid)) {
		return { status: "invalid", field: "participantUids", error: "Escolha ao menos uma pessoa além de você." };
	}

	let split: { uid: string; amountCents: number }[];
	try {
		split = splitEqually(input.amountCents, input.participantUids, uid);
	} catch {
		return { status: "invalid", field: "amountCents", error: "Esse valor é pequeno demais para dividir entre tantas pessoas." };
	}

	const _id = new ObjectId();
	const uploaded: AttachmentMeta[] = [];
	try {
		for (const f of files) {
			uploaded.push(
				await putAttachment(store, {
					groupId,
					expenseId: _id.toHexString(),
					bytes: f.bytes,
					name: f.name,
					contentType: f.contentType,
				}),
			);
		}
		const now = new Date();
		const doc: ExpenseDoc = {
			_id,
			groupId: new ObjectId(groupId),
			createdBy: uid,
			paidBy: uid,
			description: input.description,
			amountCents: input.amountCents,
			date: input.date,
			pix: { type: payer.pixKey.type, key: payer.pixKey.key, payeeName: personName(payer) },
			shares: split.map((s) => ({
				uid: s.uid,
				amountCents: s.amountCents,
				status: s.uid === uid ? "payer" : "pending",
			})),
			attachments: uploaded,
			createdAt: now,
			updatedAt: now,
		};
		await expensesCollection(db).insertOne(doc);
		return { status: "ok", expense: await toDetail(db, doc, group, uid) };
	} catch (err) {
		// Falhou depois dos uploads (ou durante): não deixa arquivos órfãos.
		await deleteAttachments(store, uploaded.map((a) => a.key));
		throw err;
	}
}

// ---------- lista ----------

export type ExpenseListItem = {
	id: string;
	description: string;
	amountCents: number;
	date: string;
	paidBy: { uid: string; name: string; isYou: boolean };
	yourShareCents: number;
	yourStatus: ShareStatus | "none";
	pendingCount: number;
	attachmentCount: number;
};

/** null se o grupo não existe ou `uid` não é membro. */
export async function listExpenses(db: Db, groupId: string, uid: string): Promise<ExpenseListItem[] | null> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return null;
	const docs = await expensesCollection(db)
		.find({ groupId: new ObjectId(groupId) })
		.sort({ date: -1, createdAt: -1, _id: -1 })
		.limit(100)
		.toArray();
	const people = await loadPeople(db, [...new Set(docs.map((d) => d.paidBy))]);
	return docs.map((d) => {
		const mine = d.shares.find((s) => s.uid === uid);
		return {
			id: d._id.toHexString(),
			description: d.description,
			amountCents: d.amountCents,
			date: d.date,
			paidBy: { uid: d.paidBy, name: personName(people.get(d.paidBy)), isYou: d.paidBy === uid },
			yourShareCents: mine?.amountCents ?? 0,
			yourStatus: mine ? mine.status : d.paidBy === uid ? "payer" : "none",
			pendingCount: d.shares.filter((s) => s.status === "pending").length,
			attachmentCount: d.attachments.length,
		};
	});
}

// ---------- anexo ----------

export type AttachmentRef =
	| { status: "ok"; key: string; name: string; contentType: string }
	| { status: "not_found" };

export async function getAttachmentRef(db: Db, groupId: string, eid: string, aid: string, uid: string): Promise<AttachmentRef> {
	if (!ATTACHMENT_ID_RE.test(aid)) return { status: "not_found" };
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "not_found" };
	const e = await findExpense(db, groupId, eid);
	const a = e?.attachments.find((x) => x.id === aid);
	if (!a) return { status: "not_found" };
	return { status: "ok", key: a.key, name: a.name, contentType: a.contentType };
}

// ---------- apagar ----------

export type DeleteResult =
	| { status: "ok" }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "has_payment" };

export async function deleteExpense(db: Db, store: AttachmentStore, groupId: string, eid: string, uid: string): Promise<DeleteResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const e = await findExpense(db, groupId, eid);
	if (!e) return { status: "no_expense" };
	const isAdmin = group.members.some((m) => m.uid === uid && m.role === "admin");
	if (e.createdBy !== uid && !isAdmin) return { status: "forbidden" };
	if (hasPaid(e)) return { status: "has_payment" };

	// Condicional: se um pagamento entrar no meio do caminho, não apaga.
	const res = await expensesCollection(db).deleteOne({
		_id: e._id,
		groupId: e.groupId,
		"shares.status": { $ne: "paid" },
	});
	if (res.deletedCount === 0) {
		return (await findExpense(db, groupId, eid)) ? { status: "has_payment" } : { status: "no_expense" };
	}
	await deleteAttachments(store, e.attachments.map((a) => a.key));
	return { status: "ok" };
}

// ---------- marcar parte como paga ----------

export type MarkShareResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "no_share" };

/**
 * Quem pagou a despesa marca (ou desmarca) a parte de outra pessoa. Uma única atualização condicional;
 * só se nada casar é que lemos a despesa, para explicar o motivo.
 */
export async function setSharePaid(
	db: Db,
	groupId: string,
	eid: string,
	uid: string,
	targetUid: string,
	status: "paid" | "pending",
): Promise<MarkShareResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	if (!isObjectIdHex(eid)) return { status: "no_expense" };

	const now = new Date();
	// arrayFilters só tocam a cota que de fato muda: repetir a ação não mexe em paidAt (idempotente).
	const change =
		status === "paid"
			? {
					filter: { "t.uid": targetUid, "t.status": "pending" },
					update: {
						$set: {
							"shares.$[t].status": "paid" as const,
							"shares.$[t].paidAt": now,
							"shares.$[t].markedBy": uid,
							"shares.$[t].method": "manual" as const,
							updatedAt: now,
						},
					},
				}
			: {
					filter: { "t.uid": targetUid, "t.status": "paid" },
					update: {
						$set: { "shares.$[t].status": "pending" as const, updatedAt: now },
						$unset: { "shares.$[t].paidAt": "" as const, "shares.$[t].markedBy": "" as const, "shares.$[t].method": "" as const },
					},
				};

	const expenses = expensesCollection(db);
	const res = await expenses.updateOne(
		{
			_id: new ObjectId(eid),
			groupId: new ObjectId(groupId),
			paidBy: uid,
			shares: { $elemMatch: { uid: targetUid, status: { $ne: "payer" } } },
		},
		change.update,
		{ arrayFilters: [change.filter] },
	);

	const e = await findExpense(db, groupId, eid);
	if (res.matchedCount > 0) {
		// Já está no estado pedido: matchedCount > 0 sem modificar é sucesso.
		return e ? { status: "ok", expense: await toDetail(db, e, group, uid) } : { status: "no_expense" };
	}
	if (!e) return { status: "no_expense" };
	if (e.paidBy !== uid) return { status: "forbidden" };
	return { status: "no_share" };
}

// ---------- resumo ----------

/** Só grupos em que `uid` é membro AGORA. Agregação única sobre as cotas pendentes. */
export async function getSummary(db: Db, uid: string): Promise<{ toReceiveCents: number; toPayCents: number }> {
	const groups = await groupsCollection(db)
		.find({ "members.uid": uid }, { projection: { _id: 1 } })
		.toArray();
	if (groups.length === 0) return { toReceiveCents: 0, toPayCents: 0 };

	const rows = await expensesCollection(db)
		.aggregate<{ toPay: number; toReceive: number }>([
			{ $match: { groupId: { $in: groups.map((g) => g._id) }, $or: [{ paidBy: uid }, { "shares.uid": uid }] } },
			{ $unwind: "$shares" },
			{ $match: { "shares.status": "pending" } },
			{
				$group: {
					_id: null,
					toPay: { $sum: { $cond: [{ $eq: ["$shares.uid", uid] }, "$shares.amountCents", 0] } },
					toReceive: {
						$sum: {
							$cond: [{ $and: [{ $eq: ["$paidBy", uid] }, { $ne: ["$shares.uid", uid] }] }, "$shares.amountCents", 0],
						},
					},
				},
			},
		])
		.toArray();
	return { toReceiveCents: rows[0]?.toReceive ?? 0, toPayCents: rows[0]?.toPay ?? 0 };
}
