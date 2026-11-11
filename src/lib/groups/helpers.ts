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

export type MemberView = {
	uid: string;
	name: string;
	picture: string | null;
	role: "admin" | "member";
	hasPixKey: boolean;
	isYou: boolean;
};

/** Administradores primeiro, depois por nome. */
export function sortMembers(members: MemberView[]): MemberView[] {
	return [...members].sort((a, b) => {
		if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
		return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
	});
}
