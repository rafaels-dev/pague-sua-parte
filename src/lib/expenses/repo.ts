import { ObjectId, type Db } from "mongodb";
import { groupsCollection, type GroupDoc } from "@/lib/groups/repo";
import { actsFor, isManagedMember, isManagedUid, isObjectIdHex } from "@/lib/groups/helpers";
import type { PixKey } from "@/lib/pix/key";
import {
	deleteAttachments,
	putAttachment,
	type AttachmentMeta,
	type AttachmentStore,
} from "@/lib/storage/attachments";
import { usersCollection, type UserDoc } from "@/lib/users/repo";
import { getBalancesForUids } from "./balances";
import {
	dueCents,
	hasPayments,
	normalizeShares,
	orderShares,
	participantUidsOf,
	recalcShares,
	refundCents,
	settleShare,
	shareStatus,
	undoShare,
	type ExpenseShare,
	type ShareMethod,
	type ShareStatus,
} from "./shares";
import { splitEqually } from "./split";
import type { ExpenseInput, SniffedFile } from "./validation";

export type { ExpenseShare, ShareMethod, ShareStatus } from "./shares";

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
	/** Cresce a cada escrita em `shares` (concorrência otimista). Ausente em documentos antigos = 0. */
	version?: number;
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

/** Projeção explícita: e-mail e chave Pix de ninguém saem do banco aqui. Pessoas sem login não têm documento. */
async function loadPeople(db: Db, uids: string[]): Promise<Map<string, PersonDoc>> {
	const real = uids.filter((u) => !isManagedUid(u));
	if (real.length === 0) return new Map();
	const users = await usersCollection(db)
		.find<PersonDoc>({ _id: { $in: real } }, { projection: { name: 1, displayName: 1, picture: 1 } })
		.toArray();
	return new Map(users.map((u) => [u._id, u]));
}

/** Nomes, tipos e responsáveis, sempre pelo grupo ATUAL (quem saiu vira "Participante"). */
type Directory = {
	name: (uid: string) => string;
	picture: (uid: string) => string | null;
	kind: (uid: string) => "user" | "managed";
	youManage: (uid: string) => boolean;
	managedByName: (uid: string) => string | null;
};

function directory(group: GroupDoc, people: Map<string, PersonDoc>, caller: string): Directory {
	const entry = (uid: string) => group.members.find((m) => m.uid === uid);
	const kind = (uid: string): "user" | "managed" => (entry(uid)?.kind === "managed" || (!entry(uid) && isManagedUid(uid)) ? "managed" : "user");
	const name = (uid: string) => (kind(uid) === "managed" ? entry(uid)?.name?.trim() || "Participante" : personName(people.get(uid)));
	return {
		name,
		picture: (uid) => (kind(uid) === "managed" ? null : (people.get(uid)?.picture ?? null)),
		kind,
		youManage: (uid) => uid !== caller && actsFor(group.members, caller, uid),
		managedByName: (uid) => {
			const by = entry(uid)?.managedBy;
			return by && entry(uid)?.kind === "managed" ? name(by) : null;
		},
	};
}

/** Todos os uids cujos nomes a tela pode precisar (inclui responsáveis). */
function uidsToLoad(group: GroupDoc, uids: string[]): string[] {
	const out = new Set(uids);
	for (const u of uids) {
		const by = group.members.find((m) => m.uid === u && m.kind === "managed")?.managedBy;
		if (by) out.add(by);
	}
	return [...out];
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
	/** Só quem pagou pode mudar quem divide. */
	canEditParticipants: boolean;
	/** Quem divide agora (cotas com valor > 0). */
	participantUids: string[];
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean; kind: "user" | "managed"; youManage: boolean };
	pix: { type: string; key: string; payeeName: string };
	shares: {
		uid: string;
		name: string;
		picture: string | null;
		amountCents: number;
		paidCents: number;
		dueCents: number;
		refundCents: number;
		participates: boolean;
		status: ShareStatus;
		isYou: boolean;
		kind: "user" | "managed";
		youManage: boolean;
		managedByName: string | null;
		paidAt: string | null;
		method: ShareMethod | null;
	}[];
	attachments: { id: string; name: string; contentType: string; size: number }[];
};

/** Quem age pelo dono (ele mesmo ou o responsável por ele, no grupo de agora) ou administra o grupo. */
function canDeleteExpense(e: ExpenseDoc, group: GroupDoc, uid: string) {
	const isAdmin = group.members.some((m) => m.uid === uid && m.role === "admin");
	return (actsFor(group.members, uid, e.paidBy) || isAdmin) && !hasPayments(e);
}

async function toDetail(db: Db, e: ExpenseDoc, group: GroupDoc, uid: string): Promise<ExpenseDetail> {
	const people = await loadPeople(db, uidsToLoad(group, [...new Set([e.paidBy, ...e.shares.map((s) => s.uid)])]));
	const dir = directory(group, people, uid);
	const view = (u: string) => ({ uid: u, name: dir.name(u), picture: dir.picture(u), isYou: u === uid });
	const owns = actsFor(group.members, uid, e.paidBy);
	return {
		id: e._id.toHexString(),
		groupId: e.groupId.toHexString(),
		description: e.description,
		amountCents: e.amountCents,
		date: e.date,
		createdAt: e.createdAt.toISOString(),
		canDelete: canDeleteExpense(e, group, uid),
		canMarkPaid: owns,
		canEditParticipants: owns,
		participantUids: participantUidsOf(e.shares),
		paidBy: { ...view(e.paidBy), kind: dir.kind(e.paidBy), youManage: dir.youManage(e.paidBy) },
		pix: { type: e.pix.type, key: e.pix.key, payeeName: e.pix.payeeName },
		shares: orderShares(e.shares, e.paidBy, dir.name).map((s) => ({
			...view(s.uid),
			kind: dir.kind(s.uid),
			youManage: dir.youManage(s.uid),
			managedByName: dir.managedByName(s.uid),
			amountCents: s.amountCents,
			paidCents: s.paidCents,
			dueCents: dueCents(s, e.paidBy),
			refundCents: refundCents(s, e.paidBy),
			participates: s.amountCents > 0,
			status: shareStatus(s, e.paidBy),
			paidAt: s.paidCents > 0 && s.paidAt ? new Date(s.paidAt).toISOString() : null,
			method: s.paidCents > 0 ? (s.method ?? null) : null,
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
	const e = await expensesCollection(db).findOne({ _id: new ObjectId(eid), groupId: new ObjectId(groupId) });
	// Lê cotas do modelo antigo (status) como paidCents, num só lugar.
	return e ? { ...e, shares: normalizeShares(e.shares) } : null;
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
	/** `name` presente quando a chave que falta é de uma pessoa sem login. */
	| { status: "no_pix"; name?: string }
	| { status: "invalid"; error: string; field: string };

export async function createExpense(
	db: Db,
	store: AttachmentStore,
	args: { groupId: string; uid: string; input: ExpenseInput; files: SniffedFile[] },
): Promise<CreateResult> {
	const { groupId, uid, input, files } = args;
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };

	// Quem pagou: o próprio usuário ou uma pessoa sem login que ele cuida (nunca um uid vindo do cliente sem conferir).
	const paidBy = input.paidByUid ?? uid;
	let pix: ExpenseDoc["pix"];
	if (paidBy === uid) {
		const payer = await usersCollection(db).findOne({ _id: uid }, { projection: { name: 1, displayName: 1, pixKey: 1 } });
		if (!payer?.pixKey) return { status: "no_pix" };
		pix = { type: payer.pixKey.type, key: payer.pixKey.key, payeeName: personName(payer) };
	} else {
		if (!isManagedMember(group.members, paidBy) || !actsFor(group.members, uid, paidBy)) {
			return { status: "invalid", field: "paidByUid", error: "Você só pode lançar despesas pagas por você ou por quem você cuida." };
		}
		const managed = group.members.find((m) => m.uid === paidBy)!;
		const name = managed.name?.trim() || "Participante";
		if (!managed.pixKey) return { status: "no_pix", name };
		pix = { type: managed.pixKey.type, key: managed.pixKey.key, payeeName: name };
	}

	const memberUids = new Set(group.members.map((m) => m.uid));
	if (!input.participantUids.every((p) => memberUids.has(p))) {
		return { status: "invalid", field: "participantUids", error: "Escolha apenas pessoas que estão no grupo." };
	}

	let split: { uid: string; amountCents: number }[];
	try {
		split = splitEqually(input.amountCents, input.participantUids, paidBy);
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
			paidBy,
			description: input.description,
			amountCents: input.amountCents,
			date: input.date,
			pix,
			shares: split.map((s) => ({ uid: s.uid, amountCents: s.amountCents, paidCents: 0 })),
			version: 0,
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
	paidBy: { uid: string; name: string; isYou: boolean; youManage: boolean };
	yourShareCents: number;
	yourStatus: ShareStatus | "none";
	yourDueCents: number;
	yourRefundCents: number;
	pendingCount: number;
	refundCount: number;
	attachmentCount: number;
	/** Cotas (que não são do dono) das pessoas sem login que o usuário cuida. */
	managed: { uid: string; name: string; status: ShareStatus; dueCents: number; refundCents: number }[];
	/** Só quando o usuário age pelo dono (dono sem login): situação de quem cobra. */
	ownerView: { pendingCount: number; refundCount: number } | null;
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
	const dir = directory(group, people, uid);
	return docs.map((raw) => {
		const d = { ...raw, shares: normalizeShares(raw.shares) };
		const mine = d.shares.find((s) => s.uid === uid);
		const pendingCount = d.shares.filter((s) => dueCents(s, d.paidBy) > 0).length;
		const refundCount = d.shares.filter((s) => refundCents(s, d.paidBy) > 0).length;
		return {
			id: d._id.toHexString(),
			description: d.description,
			amountCents: d.amountCents,
			date: d.date,
			paidBy: { uid: d.paidBy, name: dir.name(d.paidBy), isYou: d.paidBy === uid, youManage: dir.youManage(d.paidBy) },
			yourShareCents: mine?.amountCents ?? 0,
			yourStatus: mine ? shareStatus(mine, d.paidBy) : d.paidBy === uid ? "payer" : "none",
			yourDueCents: mine ? dueCents(mine, d.paidBy) : 0,
			yourRefundCents: mine ? refundCents(mine, d.paidBy) : 0,
			pendingCount,
			refundCount,
			attachmentCount: d.attachments.length,
			managed: d.shares
				.filter((s) => s.uid !== d.paidBy && dir.youManage(s.uid))
				.map((s) => ({
					uid: s.uid,
					name: dir.name(s.uid),
					status: shareStatus(s, d.paidBy),
					dueCents: dueCents(s, d.paidBy),
					refundCents: refundCents(s, d.paidBy),
				})),
			ownerView: dir.youManage(d.paidBy) ? { pendingCount, refundCount } : null,
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
	if (!actsFor(group.members, uid, e.paidBy) && !isAdmin) return { status: "forbidden" };
	if (hasPayments(e)) return { status: "has_payment" };

	// Condicional: se um pagamento entrar no meio do caminho, não apaga.
	const res = await expensesCollection(db).deleteOne({
		_id: e._id,
		groupId: e.groupId,
		// Quem pagou tem sempre paidCents 0, então qualquer paidCents > 0 é pagamento de outra pessoa.
		// Também o modelo antigo (status 'paid', sem paidCents) conta como pagamento.
		shares: { $not: { $elemMatch: { $or: [{ paidCents: { $gt: 0 } }, { status: "paid" }] } } },
	});
	if (res.deletedCount === 0) {
		return (await findExpense(db, groupId, eid)) ? { status: "has_payment" } : { status: "no_expense" };
	}
	await deleteAttachments(store, e.attachments.map((a) => a.key));
	return { status: "ok" };
}

// ---------- alterar cotas (concorrência otimista) ----------

const CONFLICT_RETRIES = 1;
const versionFilter = (e: ExpenseDoc) => (e.version === undefined ? { version: { $exists: false } } : { version: e.version });

type Mutation = (e: ExpenseDoc) => { shares: ExpenseShare[]; changed: boolean } | { error: unknown };
type Mutated =
	| { kind: "ok"; doc: ExpenseDoc }
	| { kind: "no_expense" }
	| { kind: "conflict" }
	| { kind: "rejected"; error: unknown };

/**
 * Lê a despesa, calcula as novas cotas e grava só se a `version` lida ainda for a atual.
 * Se perder a corrida, relê e tenta mais uma vez; depois disso, "conflict".
 */
async function mutateShares(db: Db, groupId: string, eid: string, mutate: Mutation): Promise<Mutated> {
	if (!isObjectIdHex(eid)) return { kind: "no_expense" };
	for (let attempt = 0; attempt <= CONFLICT_RETRIES; attempt++) {
		const e = await findExpense(db, groupId, eid);
		if (!e) return { kind: "no_expense" };
		const m = mutate(e);
		if ("error" in m) return { kind: "rejected", error: m.error };
		if (!m.changed) return { kind: "ok", doc: e };
		const now = new Date();
		const res = await expensesCollection(db).updateOne(
			{ _id: e._id, groupId: e.groupId, paidBy: e.paidBy, ...versionFilter(e) },
			{ $set: { shares: m.shares, updatedAt: now }, $inc: { version: 1 } },
		);
		if (res.matchedCount > 0) return { kind: "ok", doc: { ...e, shares: m.shares, version: (e.version ?? 0) + 1, updatedAt: now } };
	}
	return { kind: "conflict" };
}

// ---------- quitar / desfazer ----------

export type MarkShareResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "no_share" }
	| { status: "conflict" };

/**
 * Quem pagou a despesa quita (paid) ou desfaz (pending) a cota de outra pessoa. "Quitar" vale tanto para
 * receber o que falta quanto para devolver um reembolso. Idempotente.
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
	const r = await mutateShares(db, groupId, eid, (e) => {
		if (!actsFor(group.members, uid, e.paidBy)) return { error: "forbidden" };
		const change = status === "paid" ? settleShare(e.shares, e.paidBy, targetUid, new Date(), uid) : undoShare(e.shares, e.paidBy, targetUid);
		return change ?? { error: "no_share" };
	});
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") return { status: r.error === "forbidden" ? "forbidden" : "no_share" };
	return { status: "ok", expense: await toDetail(db, r.doc, group, uid) };
}

// ---------- mudar quem divide ----------

export type UpdateParticipantsResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "invalid"; error: string; field: string }
	| { status: "conflict" };

/** Refaz a divisão do total entre `participantUids`, sem perder o que já foi pago (ver `recalcShares`). */
export async function updateParticipants(
	db: Db,
	groupId: string,
	eid: string,
	uid: string,
	participantUids: string[],
): Promise<UpdateParticipantsResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };

	const memberUids = new Set(group.members.map((m) => m.uid));
	const r = await mutateShares(db, groupId, eid, (e) => {
		if (!actsFor(group.members, uid, e.paidBy)) return { error: { status: "forbidden" } };
		if (participantUids.length === 0 || new Set(participantUids).size !== participantUids.length) {
			return { error: { status: "invalid", field: "participantUids", error: "Escolha quem divide a despesa." } };
		}
		if (!participantUids.every((p) => memberUids.has(p))) {
			return { error: { status: "invalid", field: "participantUids", error: "Escolha apenas pessoas que estão no grupo." } };
		}
		try {
			return { shares: recalcShares(e.shares, e.paidBy, e.amountCents, participantUids), changed: true };
		} catch {
			return {
				error: { status: "invalid", field: "amountCents", error: "Esse valor é pequeno demais para dividir entre tantas pessoas." },
			};
		}
	});
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") return r.error as { status: "forbidden" } | { status: "invalid"; error: string; field: string };
	return { status: "ok", expense: await toDetail(db, r.doc, group, uid) };
}

// ---------- resumo ----------

export type Summary = {
	toReceiveCents: number;
	toPayCents: number;
	managed: { uid: string; name: string; groupId: string; groupName: string; toReceiveCents: number; toPayCents: number }[];
};

/**
 * Só grupos em que `uid` é membro AGORA. Os totais são estritamente os de `uid` (a mesma conta de GET /api/groups);
 * `managed` traz o saldo de cada pessoa sem login pela qual `uid` é responsável AGORA. Uma única agregação.
 */
export async function getSummary(db: Db, uid: string): Promise<Summary> {
	const groups = await groupsCollection(db)
		.find({ "members.uid": uid }, { projection: { _id: 1, name: 1, members: 1 } })
		.toArray();
	const managedList = groups.flatMap((g) =>
		g.members
			.filter((m) => m.kind === "managed" && m.managedBy === uid)
			.map((m) => ({ uid: m.uid, name: m.name?.trim() || "Participante", groupId: g._id.toHexString(), groupName: g.name })),
	);
	const balances = await getBalancesForUids(
		db,
		[uid, ...new Set(managedList.map((m) => m.uid))],
		groups.map((g) => g._id),
	);
	let toReceiveCents = 0;
	let toPayCents = 0;
	for (const g of groups) {
		const b = balances.get(`${g._id.toHexString()}:${uid}`);
		toReceiveCents += b?.toReceiveCents ?? 0;
		toPayCents += b?.toPayCents ?? 0;
	}
	return {
		toReceiveCents,
		toPayCents,
		managed: managedList.map((m) => {
			const b = balances.get(`${m.groupId}:${m.uid}`);
			return { ...m, toReceiveCents: b?.toReceiveCents ?? 0, toPayCents: b?.toPayCents ?? 0 };
		}),
	};
}
