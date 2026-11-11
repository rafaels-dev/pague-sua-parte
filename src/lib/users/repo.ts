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
	createdAt: Date;
	updatedAt: Date;
};

export function usersCollection(db: Db) {
	return db.collection<UserDoc>("users");
}

/** Cria no primeiro login; depois atualiza nome/e-mail/foto. Nunca mexe em pixKey/displayName. */
export async function upsertFromAuth(db: Db, user: AuthUser): Promise<UserDoc> {
	const now = new Date();
	const $set: Partial<UserDoc> = { email: user.email, name: user.name, updatedAt: now };
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
