import type { Db, ObjectId } from "mongodb";
import { z } from "zod";
import { isAllowedPushEndpoint } from "./endpoint";

export const MAX_SUBSCRIPTIONS_PER_USER = 10;

export type PushSubscriptionDoc = {
	_id?: ObjectId;
	uid: string;
	endpoint: string;
	keys: { p256dh: string; auth: string };
	createdAt: Date;
};

export const subscriptionSchema = z.object({
	endpoint: z
		.string()
		.max(1000)
		.refine(isAllowedPushEndpoint, "Endereço inválido."),
	keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof subscriptionSchema>;

export const subscriptionsCollection = (db: Db) => db.collection<PushSubscriptionDoc>("push_subscriptions");

/** Grava a inscrição do aparelho. Se o endereço já era de outro usuário (mesmo aparelho, outra conta), passa para este. Guarda no máximo 10 por usuário. */
export async function saveSubscription(db: Db, uid: string, sub: PushSubscriptionInput, now: Date = new Date()): Promise<void> {
	const col = subscriptionsCollection(db);
	// `createdAt` vale "quando foi (re)ativada": a poda de 10 por usuário nunca apaga a que acabou de ser ativada.
	// O endereço é do aparelho: se já era de outro usuário (conta trocada sem "Sair"), passa para este.
	const write = () => col.updateOne({ endpoint: sub.endpoint }, { $set: { uid, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, createdAt: now } }, { upsert: true });
	try {
		await write();
	} catch (err) {
		// Duplo clique: duas inserções simultâneas do mesmo endereço; a segunda perde a corrida e basta repetir (agora atualiza).
		if ((err as { code?: number }).code !== 11000) throw err;
		await write();
	}
	const extra = await col.find({ uid }, { projection: { _id: 1 } }).sort({ createdAt: -1 }).skip(MAX_SUBSCRIPTIONS_PER_USER).toArray();
	if (extra.length) await col.deleteMany({ _id: { $in: extra.map((x) => x._id!) }, uid });
}

/** Remove só se a inscrição é deste usuário. */
export async function removeSubscription(db: Db, uid: string, endpoint: string): Promise<void> {
	await subscriptionsCollection(db).deleteOne({ uid, endpoint });
}

export async function removeEndpoints(db: Db, endpoints: string[]): Promise<void> {
	if (endpoints.length) await subscriptionsCollection(db).deleteMany({ endpoint: { $in: endpoints } });
}
