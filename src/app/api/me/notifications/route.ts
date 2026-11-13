import { z } from "zod";
import { handleError as sharedHandleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { emailConfigured } from "@/lib/notifications/email";
import { pushConfigured } from "@/lib/notifications/push";
import { normalizeNotifyPrefs } from "@/lib/notifications/prefs";
import { updateNotifyPrefs, type UserDoc } from "@/lib/users/repo";
import { upsertAndWelcome } from "@/lib/notifications/welcome";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: z.boolean().optional(), push: z.boolean().optional() }).strict();

function view(u: UserDoc) {
	return {
		...normalizeNotifyPrefs(u.notify),
		canEmail: u.emailVerified === true && Boolean(u.email),
		// Só se o canal está configurado no servidor (sem expor valor nenhum).
		channels: { email: emailConfigured(), push: pushConfigured() },
	};
}

const handleError = (err: unknown) => sharedHandleError(err, "api/me/notifications");

/** Preferências de aviso: `{ email, push, canEmail, channels }`. */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		return Response.json(view(await upsertAndWelcome(await getDb(), user)));
	} catch (err) {
		return handleError(err);
	}
}

export async function PATCH(request: Request) {
	try {
		const user = await requireUser(request);
		const json: unknown = await request.json().catch(() => null);
		const parsed = bodySchema.safeParse(json);
		if (!parsed.success) return jsonError("Pedido inválido.", 422);
		const db = await getDb();
		const current = await upsertAndWelcome(db, user);
		const updated = (await updateNotifyPrefs(db, user.uid, parsed.data)) ?? current;
		return Response.json(view(updated));
	} catch (err) {
		return handleError(err);
	}
}
