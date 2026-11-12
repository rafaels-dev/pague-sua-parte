export const MAX_MEMBERS = 50;
export const MAX_NAME_LENGTH = 60;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,100}$/;

export function isObjectIdHex(value: string): boolean {
	return OBJECT_ID_RE.test(value);
}

/** Formato mínimo para evitar consultar o banco com lixo; o valor real é conferido no banco. */
export function isPlausibleToken(value: string): boolean {
	return TOKEN_RE.test(value);
}

/** 32 bytes aleatórios (Web Crypto) em base64url, sem padding. */
export function generateInviteToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newInviteExpiry(now: Date = new Date()): Date {
	return new Date(now.getTime() + INVITE_TTL_MS);
}

/** Pessoa sem login (ex.: avô sem celular), cuidada por um membro real do grupo. */
export const MANAGED_UID_PREFIX = "m_";

export function isManagedUid(uid: string): boolean {
	return uid.startsWith(MANAGED_UID_PREFIX);
}

/** `m_` + 16 bytes aleatórios (Web Crypto) em base64url: nunca colide com um uid do Firebase. */
export function generateManagedUid(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return MANAGED_UID_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type MemberLike = { uid: string; role?: "admin" | "member"; kind?: "managed"; managedBy?: string };

/** O membro `uid` é uma pessoa sem login? (pelo cadastro no grupo, nunca só pelo formato do uid) */
export function isManagedMember(members: MemberLike[], uid: string): boolean {
	return members.some((m) => m.uid === uid && m.kind === "managed");
}

/**
 * `caller` age por `uid` quando é ele mesmo, ou quando `uid` é uma pessoa sem login
 * deste grupo cujo responsável (`managedBy`) é `caller`. Única fonte desta regra.
 */
export function actsFor(members: MemberLike[], caller: string, uid: string): boolean {
	if (uid === caller) return true;
	return members.some((m) => m.uid === uid && m.kind === "managed" && m.managedBy === caller);
}

/** `uid` administra o grupo? (pessoa sem login nunca administra, mesmo que o cadastro diga "admin") */
export function isGroupAdmin(members: MemberLike[], uid: string): boolean {
	return members.some((m) => m.uid === uid && m.role === "admin" && m.kind !== "managed");
}

/**
 * Como `caller` gerencia uma despesa paga por `paidBy`: "owner" (é quem pagou ou age por quem pagou), "admin"
 * (administra o grupo) ou null (nenhum dos dois: não pode mexer). Única fonte desta regra; o dono vale primeiro.
 */
export function expenseRole(members: MemberLike[], caller: string, paidBy: string): "owner" | "admin" | null {
	if (actsFor(members, caller, paidBy)) return "owner";
	return isGroupAdmin(members, caller) ? "admin" : null;
}

export type MemberView = {
	uid: string;
	name: string;
	picture: string | null;
	role: "admin" | "member";
	hasPixKey: boolean;
	isYou: boolean;
	kind: "user" | "managed";
	managedBy: { uid: string; name: string; isYou: boolean } | null;
	youManage: boolean;
	canEdit: boolean;
	/** Só para pessoas sem login, e só para quem pode editá-las. */
	pixKey?: { type: string; key: string } | null;
};

/** Administradores, depois usuários reais por nome, depois pessoas sem login por nome. */
export function sortMembers(members: MemberView[]): MemberView[] {
	const rank = (m: MemberView) => (m.kind === "managed" ? 2 : m.role === "admin" ? 0 : 1);
	return [...members].sort((a, b) => {
		if (rank(a) !== rank(b)) return rank(a) - rank(b);
		return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
	});
}
