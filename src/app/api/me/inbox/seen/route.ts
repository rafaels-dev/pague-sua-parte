import { z } from "zod";
import { handleError as sharedHandleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { countUnseen, markSeen } from "@/lib/notifications/inbox";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ upTo: z.string().datetime({ offset: true }) }).strict();

/**
 * A pessoa abriu a lista: o que chegou até `upTo` (o `seenUpTo` que a lista devolveu; limitado a agora) conta como visto.
 * Sem corpo = agora. `upTo` inválido = 422. Devolve o contador que sobrou.
 */
export async function POST(request: Request) {
	try {
		const user = await requireUser(request);
		const text = await request.text().catch(() => "");
		let upTo: Date | undefined;
		if (text.trim() !== "") {
			let json: unknown = null;
			try {
				json = JSON.parse(text);
			} catch {
				// segue: o esquema recusa
			}
			const parsed = bodySchema.safeParse(json);
			if (!parsed.success) return jsonError("Pedido inválido.", 422);
			upTo = new Date(parsed.data.upTo);
		}
		const db = await getDb();
		await markSeen(db, user.uid, upTo);
		return Response.json({ unseen: await countUnseen(db, user.uid) }, { headers: { "Cache-Control": "private, no-store" } });
	} catch (err) {
		return sharedHandleError(err, "api/me/inbox/seen");
	}
}
