import { z } from "zod";
import { handleError as sharedHandleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { isInboxId, markAllRead, markRead } from "@/lib/notifications/inbox";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
	z.object({ id: z.string().refine(isInboxId) }).strict(),
	z.object({ all: z.literal(true) }).strict(),
]);

/** `{ id }` marca um aviso como lido; `{ all: true }` marca todos. Id de outra pessoa ou inexistente: mesma resposta, sem efeito. */
export async function POST(request: Request) {
	try {
		const user = await requireUser(request);
		const parsed = bodySchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return jsonError("Pedido inválido.", 422);
		const db = await getDb();
		if ("all" in parsed.data) await markAllRead(db, user.uid);
		else await markRead(db, user.uid, parsed.data.id);
		return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
	} catch (err) {
		return sharedHandleError(err, "api/me/inbox/read");
	}
}
