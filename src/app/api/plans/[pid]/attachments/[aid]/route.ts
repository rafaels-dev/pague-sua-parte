import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { planResponse } from "@/lib/plans/http";
import { getPhotoRef, removePhoto } from "@/lib/plans/repo";
import { getAttachment, getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pid: string; aid: string }> };

/** `filename` só ASCII (cabeçalhos HTTP); o nome completo vai em `filename*`. */
function contentDisposition(name: string) {
	const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
	return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** A foto, só para quem participa do plano, sempre pela API (o endereço do armazenamento nunca sai). */
export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { pid, aid } = await params;
		const ref = await getPhotoRef(await getDb(), pid, user.uid, aid);
		if (!ref) return jsonError("Foto não encontrada.", 404);
		const file = await getAttachment(getAttachmentStore(), ref.key);
		if (!file) return jsonError("Foto não encontrada.", 404);
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
		return handleError(err, "api/plans/[pid]/attachments/[aid] GET");
	}
}

export async function DELETE(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { pid, aid } = await params;
		return planResponse(await removePhoto(await getDb(), getAttachmentStore(), pid, user.uid, aid));
	} catch (err) {
		return handleError(err, "api/plans/[pid]/attachments/[aid] DELETE");
	}
}
