import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getAttachmentRef } from "@/lib/expenses/repo";
import { getAttachment, getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string; aid: string }> };

/** `filename` só ASCII (cabeçalhos HTTP); o nome completo vai em `filename*`. */
function contentDisposition(name: string) {
	const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
	return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid, aid } = await params;
		const ref = await getAttachmentRef(await getDb(), id, eid, aid, user.uid);
		if (ref.status !== "ok") return jsonError("Anexo não encontrado.", 404);
		const file = await getAttachment(getAttachmentStore(), ref.key);
		if (!file) return jsonError("Anexo não encontrado.", 404);
		return new Response(file.body, {
			headers: {
				"Content-Type": ref.contentType,
				"Content-Length": String(file.size),
				"Content-Disposition": contentDisposition(ref.name),
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "default-src 'none'; sandbox",
				"Cache-Control": "private, no-store",
			},
		});
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/attachments/[aid] GET");
	}
}
