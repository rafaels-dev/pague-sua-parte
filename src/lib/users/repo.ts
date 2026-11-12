import type { Db } from "mongodb";
import type { AuthUser } from "@/lib/auth/server";
import type { PixKey } from "@/lib/pix/key";

export type UserDoc = {
	_id: string;
	email: string;
	name: string;
	picture?: string;
	displayName?: string;
	pixKey?: PixKey;
	/** O Google confirmou o e-mail: só então ele recebe avisos. */
	emailVerified?: boolean;
	/** Preferências de aviso; o que falta vale "ligado". */
	notify?: { email?: boolean; push?: boolean };
	createdAt: Date;
	updatedAt: Date;
};

export function usersCollection(db: Db) {
	return db.collection<UserDoc>("users");
}

/** Cria no primeiro login; depois atualiza nome/e-mail/foto. Nunca mexe em pixKey/displayName. */
export async function upsertFromAuth(db: Db, user: AuthUser): Promise<UserDoc> {
	const now = new Date();
	const $set: Partial<UserDoc> = { email: user.email, emailVerified: user.emailVerified, name: user.name, updatedAt: now };
	const update: Record<string, unknown> = { $set, $setOnInsert: { createdAt: now } };
	if (user.picture) $set.picture = user.picture;
	else update.$unset = { picture: "" };

	const doc = await usersCollection(db).findOneAndUpdate({ _id: user.uid }, update, {
		upsert: true,
		returnDocument: "after",
	});
	if (!doc) throw new Error("Falha ao gravar o usuário.");
	return doc;
}

/** `pixKey: null` remove a chave. Campos ausentes não são alterados. */
export async function updateProfile(
	db: Db,
	uid: string,
	patch: { displayName?: string; pixKey?: PixKey | null },
): Promise<UserDoc | null> {
	const $set: Record<string, unknown> = { updatedAt: new Date() };
	const $unset: Record<string, ""> = {};
	if (patch.displayName !== undefined) $set.displayName = patch.displayName;
	if (patch.pixKey === null) $unset.pixKey = "";
	else if (patch.pixKey !== undefined) $set.pixKey = patch.pixKey;

	const update: Record<string, unknown> = { $set };
	if (Object.keys($unset).length) update.$unset = $unset;
	return usersCollection(db).findOneAndUpdate({ _id: uid }, update, { returnDocument: "after" });
}

/** Liga/desliga os avisos. Só mexe no que foi enviado. */
export async function updateNotifyPrefs(db: Db, uid: string, patch: { email?: boolean; push?: boolean }): Promise<UserDoc | null> {
	const $set: Record<string, unknown> = { updatedAt: new Date() };
	if (patch.email !== undefined) $set["notify.email"] = patch.email;
	if (patch.push !== undefined) $set["notify.push"] = patch.push;
	return usersCollection(db).findOneAndUpdate({ _id: uid }, { $set }, { returnDocument: "after" });
}
