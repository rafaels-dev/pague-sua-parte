import { ObjectId, type Db } from "mongodb";
import { usersCollection, type UserDoc } from "@/lib/users/repo";
import {
	generateInviteToken,
	isObjectIdHex,
	isPlausibleToken,
	MAX_MEMBERS,
	newInviteExpiry,
	sortMembers,
	type MemberView,
} from "./helpers";

export type Role = "admin" | "member";
export type GroupMember = { uid: string; role: Role; joinedAt: Date };
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

export async function listGroups(db: Db, uid: string): Promise<GroupSummary[]> {
	const docs = await groupsCollection(db)
		.find({ "members.uid": uid })
		.sort({ createdAt: -1, _id: -1 })
		.toArray();
	return docs.map((g) => ({
		id: g._id.toHexString(),
		name: g.name,
		memberCount: g.members.length,
		role: roleOf(g, uid) ?? "member",
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
	const users = await usersCollection(db)
		.find<Pick<UserDoc, "_id" | "name" | "displayName" | "picture"> & { hasPixKey?: boolean }>(
			{ _id: { $in: group.members.map((m) => m.uid) } },
			{ projection: { name: 1, displayName: 1, picture: 1, pixKey: 1 } },
		)
		.toArray();
	const byId = new Map(users.map((u) => [u._id, u as typeof u & { pixKey?: unknown }]));

	const members = group.members.map((m): MemberView => {
		const u = byId.get(m.uid);
		return {
			uid: m.uid,
			name: u?.displayName?.trim() || u?.name || "Participante",
			picture: u?.picture ?? null,
			role: m.role,
			hasPixKey: Boolean(u?.pixKey),
			isYou: m.uid === uid,
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
	if (!isPlausibleToken(token)) return { status: "invalid" };
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
