import { z } from "zod";
import { bodyTooLarge, handleError as sharedHandleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { removeSubscription, saveSubscription, subscriptionSchema } from "@/lib/notifications/subscriptions";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const handleError = (err: unknown) => sharedHandleError(err, "api/me/push");

/** Inscreve este aparelho para receber avisos (Web Push). */
export async function POST(request: Request) {
	try {
		const user = await requireUser(request);
		if (bodyTooLarge(request, MAX_BODY_BYTES)) return jsonError("Pedido inválido.", 422);
		const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return jsonError("Pedido inválido.", 422);
		await saveSubscription(await getDb(), user.uid, parsed.data);
		return Response.json({ ok: true });
	} catch (err) {
		return handleError(err);
	}
}

/** Tira a inscrição deste aparelho (só a do próprio usuário). */
export async function DELETE(request: Request) {
	try {
		const user = await requireUser(request);
		if (bodyTooLarge(request, MAX_BODY_BYTES)) return jsonError("Pedido inválido.", 422);
		const parsed = z.object({ endpoint: z.string().max(1000) }).safeParse(await request.json().catch(() => null));
		if (!parsed.success) return jsonError("Pedido inválido.", 422);
		await removeSubscription(await getDb(), user.uid, parsed.data.endpoint);
		return Response.json({ ok: true });
	} catch (err) {
		return handleError(err);
	}
}
