import { ObjectId, type Db } from "mongodb";
import { getBalancesByGroup, ZERO_BALANCE } from "@/lib/expenses/balances";
import type { Balance } from "@/lib/expenses/shares";
import { usersCollection, type UserDoc } from "@/lib/users/repo";
import type { PixKey } from "@/lib/pix/key";
import {
	generateInviteToken,
	generateManagedUid,
	isManagedUid,
	isObjectIdHex,
	isPlausibleToken,
	MAX_MEMBERS,
	newInviteExpiry,
	sortMembers,
	type MemberView,
} from "./helpers";

export type Role = "admin" | "member";
export type GroupMember = {
	uid: string;
	role: Role;
	joinedAt: Date;
	/** Pessoa sem login, cuidada por `managedBy` (um membro real). Sempre `role: 'member'`. */
	kind?: "managed";
	name?: string;
	managedBy?: string;
	pixKey?: PixKey;
};
export type GroupDoc = {
	_id: ObjectId;
	name: string;
	createdBy: string;
	members: GroupMember[];
	invite: { token: string; expiresAt: Date } | null;
	createdAt: Date;
	updatedAt: Date;
};

export function groupsCollection(db: Db) {
	return db.collection<GroupDoc>("groups");
}

export type GroupSummary = { id: string; name: string; memberCount: number; role: Role };

function roleOf(group: GroupDoc, uid: string): Role | null {
	return group.members.find((m) => m.uid === uid)?.role ?? null;
}

export async function createGroup(db: Db, uid: string, name: string): Promise<GroupSummary> {
	const now = new Date();
	const doc: Omit<GroupDoc, "_id"> = {
		name,
		createdBy: uid,
		members: [{ uid, role: "admin", joinedAt: now }],
		invite: null,
		createdAt: now,
		updatedAt: now,
	};
	const { insertedId } = await groupsCollection(db).insertOne(doc as GroupDoc);
	return { id: insertedId.toHexString(), name, memberCount: 1, role: "admin" };
}

export type ListedGroup = GroupSummary & Balance;

export async function listGroups(db: Db, uid: string, now: Date = new Date()): Promise<ListedGroup[]> {
	const docs = await groupsCollection(db)
		.find({ "members.uid": uid })
		.sort({ createdAt: -1, _id: -1 })
		.toArray();
	// Uma única agregação para todos os grupos (nada de consulta por grupo).
	const balances = await getBalancesByGroup(db, uid, docs.map((g) => g._id), now);
	return docs.map((g) => ({
		id: g._id.toHexString(),
		name: g.name,
		memberCount: g.members.length,
		role: roleOf(g, uid) ?? "member",
		...(balances.get(g._id.toHexString()) ?? ZERO_BALANCE),
	}));
}

export type GroupDetail = { id: string; name: string; role: Role; members: MemberView[] };

/** null se o id for inválido, o grupo não existir ou `uid` não for membro (indistinguíveis). */
export async function getGroupDetail(db: Db, id: string, uid: string): Promise<GroupDetail | null> {
	if (!isObjectIdHex(id)) return null;
	const group = await groupsCollection(db).findOne({ _id: new ObjectId(id), "members.uid": uid });
	if (!group) return null;
	const role = roleOf(group, uid);
	if (!role) return null;

	// Projeção explícita: e-mail e chave Pix nunca saem do banco para esta resposta (só hasPixKey).
	// Pessoas sem login não têm documento em `users`: o nome vem da entrada no grupo.
	const realUids = group.members.filter((m) => m.kind !== "managed").map((m) => m.uid);
	const users = await usersCollection(db)
		.find<Pick<UserDoc, "_id" | "name" | "displayName" | "picture"> & { hasPixKey?: boolean }>(
			{ _id: { $in: realUids } },
			{ projection: { name: 1, displayName: 1, picture: 1, pixKey: 1 } },
		)
		.toArray();
	const byId = new Map(users.map((u) => [u._id, u as typeof u & { pixKey?: unknown }]));
	const realName = (id: string) => {
		const u = byId.get(id);
		return u?.displayName?.trim() || u?.name || "Participante";
	};

	const members = group.members.map((m): MemberView => {
		if (m.kind === "managed") {
			const canEdit = role === "admin" || m.managedBy === uid;
			return {
				uid: m.uid,
				name: m.name?.trim() || "Participante",
				picture: null,
				role: "member",
				hasPixKey: Boolean(m.pixKey),
				isYou: false,
				kind: "managed",
				managedBy: m.managedBy ? { uid: m.managedBy, name: realName(m.managedBy), isYou: m.managedBy === uid } : null,
				youManage: m.managedBy === uid,
				canEdit,
				// A chave de quem não tem login só aparece para quem pode editá-la.
				...(canEdit ? { pixKey: m.pixKey ? { type: m.pixKey.type, key: m.pixKey.key } : null } : {}),
			};
		}
		const u = byId.get(m.uid);
		return {
			uid: m.uid,
			name: realName(m.uid),
			picture: u?.picture ?? null,
			role: m.role,
			hasPixKey: Boolean(u?.pixKey),
			isYou: m.uid === uid,
			kind: "user",
			managedBy: null,
			youManage: false,
			canEdit: false,
		};
	});
	return { id: group._id.toHexString(), name: group.name, role, members: sortMembers(members) };
}

export type InviteResult =
	| { status: "ok"; token: string; expiresAt: Date }
	| { status: "not_found" }
	| { status: "forbidden" };

function currentInvite(group: GroupDoc, now: Date) {
	return group.invite && group.invite.expiresAt > now ? group.invite : null;
}

export async function getOrCreateInvite(
	db: Db,
	id: string,
	uid: string,
	regenerate: boolean,
): Promise<InviteResult> {
	if (!isObjectIdHex(id)) return { status: "not_found" };
	const groups = groupsCollection(db);
	const _id = new ObjectId(id);
	const now = new Date();

	const group = await groups.findOne({ _id, "members.uid": uid });
	if (!group) return { status: "not_found" };

	if (regenerate) {
		if (roleOf(group, uid) !== "admin") return { status: "forbidden" };
	} else {
		const existing = currentInvite(group, now);
		if (existing) return { status: "ok", token: existing.token, expiresAt: existing.expiresAt };
	}

	const invite = { token: generateInviteToken(), expiresAt: newInviteExpiry(now) };
	// Condicional: só grava se ainda for preciso (evita duas requisições simultâneas gerando links diferentes).
	const filter = regenerate
		? { _id, members: { $elemMatch: { uid, role: "admin" as const } } }
		: {
				_id,
				"members.uid": uid,
				$or: [{ invite: null }, { "invite.expiresAt": { $lte: now } }],
			};
	const res = await groups.updateOne(filter, { $set: { invite, updatedAt: now } });
	if (res.matchedCount > 0) return { status: "ok", ...invite };

	// Perdeu a corrida (ou perdeu o acesso): releia.
	const again = await groups.findOne({ _id, "members.uid": uid });
	if (!again) return { status: "not_found" };
	if (regenerate) return { status: "forbidden" };
	const existing = currentInvite(again, new Date());
	if (existing) return { status: "ok", token: existing.token, expiresAt: existing.expiresAt };
	throw new Error("Falha ao gerar o convite.");
}

export type InvitePreview = { groupId: string; groupName: string; memberCount: number; alreadyMember: boolean };

async function findByValidToken(db: Db, token: string, now: Date) {
	if (!isPlausibleToken(token)) return null;
	return groupsCollection(db).findOne({ "invite.token": token, "invite.expiresAt": { $gt: now } });
}

export async function previewInvite(db: Db, token: string, uid: string): Promise<InvitePreview | null> {
	const group = await findByValidToken(db, token, new Date());
	if (!group) return null;
	return {
		groupId: group._id.toHexString(),
		groupName: group.name,
		memberCount: group.members.length,
		alreadyMember: group.members.some((m) => m.uid === uid),
	};
}

export type AcceptResult = { status: "ok"; groupId: string } | { status: "invalid" } | { status: "full" };

export async function acceptInvite(db: Db, token: string, uid: string): Promise<AcceptResult> {
	// Pessoas sem login nunca entram (nem agem) por convite: o uid vem sempre do token verificado.
	if (!isPlausibleToken(token) || isManagedUid(uid)) return { status: "invalid" };
	const groups = groupsCollection(db);
	const now = new Date();

	// Um único update atômico: token válido, uid ainda fora, e menos de MAX_MEMBERS membros.
	const res = await groups.findOneAndUpdate(
		{
			"invite.token": token,
			"invite.expiresAt": { $gt: now },
			"members.uid": { $ne: uid },
			[`members.${MAX_MEMBERS - 1}`]: { $exists: false },
		},
		{ $push: { members: { uid, role: "member", joinedAt: now } }, $set: { updatedAt: now } },
		{ returnDocument: "after", projection: { _id: 1 } },
	);
	if (res) return { status: "ok", groupId: res._id.toHexString() };

	const group = await findByValidToken(db, token, now);
	if (!group) return { status: "invalid" };
	if (group.members.some((m) => m.uid === uid)) return { status: "ok", groupId: group._id.toHexString() };
	return { status: "full" };
}

export type MemberActionResult =
	| { status: "ok" }
	| { status: "not_found" }
	| { status: "forbidden" }
	| { status: "self" }
	| { status: "target_missing" }
	| { status: "managed_target" }
	| { status: "responsible"; name: string; managed: string[] };

async function realName(db: Db, uid: string): Promise<string> {
	const users = await usersCollection(db)
		.find<Pick<UserDoc, "_id" | "name" | "displayName">>({ _id: { $in: [uid] } }, { projection: { name: 1, displayName: 1 } })
		.toArray();
	return users[0]?.displayName?.trim() || users[0]?.name || "Participante";
}

/** Explica por que o update atômico não casou. A ordem importa: não vazar a existência do grupo. */
async function explainNoMatch(
	db: Db,
	_id: ObjectId,
	actorUid: string,
	targetUid: string,
	opts: { removing?: boolean; roleChange?: boolean } = {},
): Promise<MemberActionResult> {
	const group = await groupsCollection(db).findOne({ _id, "members.uid": actorUid });
	if (!group) return { status: "not_found" };
	if (roleOf(group, actorUid) !== "admin") return { status: "forbidden" };
	if (actorUid === targetUid) return { status: "self" };
	const target = group.members.find((m) => m.uid === targetUid);
	if (!target) return { status: "target_missing" };
	if (opts.roleChange && target.kind === "managed") return { status: "managed_target" };
	if (opts.removing && target.kind !== "managed") {
		const cared = group.members.filter((m) => m.kind === "managed" && m.managedBy === targetUid);
		if (cared.length > 0) {
			return { status: "responsible", name: await realName(db, targetUid), managed: cared.map((m) => m.name ?? "Participante") };
		}
	}
	// Casou na releitura: perdeu a corrida por pouco; o chamador pode tentar de novo.
	throw new Error("Falha ao atualizar o membro.");
}

/** Filtro: o grupo existe, quem age é admin AGORA, e o alvo é membro. */
function adminActsOnMember(_id: ObjectId, actorUid: string, targetUid: string) {
	return {
		_id,
		members: { $elemMatch: { uid: actorUid, role: "admin" as const } },
		"members.uid": targetUid,
	};
}

export async function setMemberRole(
	db: Db,
	id: string,
	actorUid: string,
	targetUid: string,
	role: Role,
): Promise<MemberActionResult> {
	if (!isObjectIdHex(id)) return { status: "not_found" };
	const groups = groupsCollection(db);
	const _id = new ObjectId(id);
	const opts = { roleChange: true };
	if (actorUid === targetUid) return explainNoMatch(db, _id, actorUid, targetUid, opts);

	const res = await groups.updateOne(
		{
			...adminActsOnMember(_id, actorUid, targetUid),
			// Pessoas sem login nunca viram administradoras.
			$nor: [{ members: { $elemMatch: { uid: targetUid, kind: "managed" } } }],
		},
		{ $set: { "members.$[t].role": role, updatedAt: new Date() } },
		{ arrayFilters: [{ "t.uid": targetUid }] },
	);
	// matchedCount (e não modifiedCount): trocar para o papel que já existe é sucesso (idempotente).
	if (res.matchedCount > 0) return { status: "ok" };
	return explainNoMatch(db, _id, actorUid, targetUid, opts);
}

/** Remove um membro real (sem ninguém sob seus cuidados) ou uma pessoa sem login. Só administradores. */
export async function removeMember(db: Db, id: string, actorUid: string, targetUid: string): Promise<MemberActionResult> {
	if (!isObjectIdHex(id)) return { status: "not_found" };
	const groups = groupsCollection(db);
	const _id = new ObjectId(id);
	const opts = { removing: true };
	if (actorUid === targetUid) return explainNoMatch(db, _id, actorUid, targetUid, opts);

	const res = await groups.updateOne(
		{
			...adminActsOnMember(_id, actorUid, targetUid),
			// Quem é responsável por alguém não sai antes de passar a responsabilidade adiante.
			$nor: [{ members: { $elemMatch: { managedBy: targetUid } } }],
		},
		{
			$pull: { members: { uid: targetUid } },
			// Invalida o convite atual na mesma operação: quem foi removido não volta com o link antigo.
			$set: { invite: null, updatedAt: new Date() },
		},
	);
	if (res.matchedCount > 0) return { status: "ok" };
	return explainNoMatch(db, _id, actorUid, targetUid, opts);
}

// ---------- pessoas sem login ----------

export type ManagedResult =
	| { status: "ok"; uid: string }
	| { status: "not_found" }
	| { status: "forbidden" }
	| { status: "target_missing" }
	| { status: "full" }
	| { status: "invalid"; field: "managedBy"; error: string };

const BAD_RESPONSIBLE = "Escolha alguém do grupo para cuidar dessa pessoa.";
const realMember = (uid: string) => ({ members: { $elemMatch: { uid, kind: { $ne: "managed" as const } } } });

export async function addManagedMember(
	db: Db,
	id: string,
	actorUid: string,
	input: { name: string; managedBy: string; pixKey?: PixKey },
): Promise<ManagedResult> {
	if (!isObjectIdHex(id)) return { status: "not_found" };
	const groups = groupsCollection(db);
	const _id = new ObjectId(id);
	const now = new Date();
	const uid = generateManagedUid();
	const member: GroupMember = {
		uid,
		role: "member",
		joinedAt: now,
		kind: "managed",
		name: input.name,
		managedBy: input.managedBy,
		...(input.pixKey ? { pixKey: input.pixKey } : {}),
	};
	// Um único update atômico: quem age é admin AGORA, o responsável é membro real AGORA e ainda há vaga.
	const res = await groups.updateOne(
		{
			_id,
			$and: [{ members: { $elemMatch: { uid: actorUid, role: "admin" } } }, realMember(input.managedBy)],
			[`members.${MAX_MEMBERS - 1}`]: { $exists: false },
		},
		{ $push: { members: member }, $set: { updatedAt: now } },
	);
	if (res.matchedCount > 0) return { status: "ok", uid };

	const group = await groups.findOne({ _id, "members.uid": actorUid });
	if (!group) return { status: "not_found" };
	if (roleOf(group, actorUid) !== "admin") return { status: "forbidden" };
	const resp = group.members.find((m) => m.uid === input.managedBy);
	if (!resp || resp.kind === "managed") return { status: "invalid", field: "managedBy", error: BAD_RESPONSIBLE };
	if (group.members.length >= MAX_MEMBERS) return { status: "full" };
	throw new Error("Falha ao adicionar a pessoa.");
}

/** `pixKey: null` limpa a chave. Admins e o responsável atual podem editar. */
export async function updateManagedMember(
	db: Db,
	id: string,
	actorUid: string,
	targetUid: string,
	patch: { name?: string; managedBy?: string; pixKey?: PixKey | null },
): Promise<ManagedResult> {
	if (!isObjectIdHex(id)) return { status: "not_found" };
	const groups = groupsCollection(db);
	const _id = new ObjectId(id);

	const $set: Record<string, unknown> = { updatedAt: new Date() };
	const $unset: Record<string, ""> = {};
	if (patch.name !== undefined) $set["members.$[t].name"] = patch.name;
	if (patch.managedBy !== undefined) $set["members.$[t].managedBy"] = patch.managedBy;
	if (patch.pixKey) $set["members.$[t].pixKey"] = patch.pixKey;
	else if (patch.pixKey === null) $unset["members.$[t].pixKey"] = "";

	const and: Record<string, unknown>[] = [
		{ members: { $elemMatch: { uid: targetUid, kind: "managed" } } },
		{
			$or: [
				{ members: { $elemMatch: { uid: actorUid, role: "admin" } } },
				// Responsável atual (e ainda membro).
				{ $and: [{ "members.uid": actorUid }, { members: { $elemMatch: { uid: targetUid, managedBy: actorUid } } }] },
			],
		},
	];
	if (patch.managedBy !== undefined) and.push(realMember(patch.managedBy));

	const res = await groups.updateOne(
		{ _id, $and: and },
		{ $set, ...(Object.keys($unset).length ? { $unset } : {}) },
		{ arrayFilters: [{ "t.uid": targetUid }] },
	);
	if (res.matchedCount > 0) return { status: "ok", uid: targetUid };

	const group = await groups.findOne({ _id, "members.uid": actorUid });
	if (!group) return { status: "not_found" };
	const target = group.members.find((m) => m.uid === targetUid);
	if (!target || target.kind !== "managed") return { status: "target_missing" };
	if (roleOf(group, actorUid) !== "admin" && target.managedBy !== actorUid) return { status: "forbidden" };
	if (patch.managedBy !== undefined) {
		const resp = group.members.find((m) => m.uid === patch.managedBy);
		if (!resp || resp.kind === "managed") return { status: "invalid", field: "managedBy", error: BAD_RESPONSIBLE };
	}
	throw new Error("Falha ao atualizar a pessoa.");
}
