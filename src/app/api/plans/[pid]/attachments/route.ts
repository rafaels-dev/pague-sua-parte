import { MULTIPART_OVERHEAD_BYTES, bodyTooLarge, handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { MAX_TOTAL_BYTES } from "@/lib/expenses/validation";
import { planResponse, readPhotos } from "@/lib/plans/http";
import { addPhotos, findPlanFor } from "@/lib/plans/repo";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = MAX_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES;

/** Acrescenta fotos ao plano (quem criou, com o plano aberto; até 3 no total). */
export async function POST(request: Request, { params }: { params: Promise<{ pid: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid } = await params;
		if (bodyTooLarge(request, MAX_BODY_BYTES)) return jsonError("As fotos podem ter no máximo 4 MB no total.", 413, "files");
		const db = await getDb();
		const plan = await findPlanFor(db, pid, user.uid);
		if (!plan) return jsonError("Plano não encontrado.", 404);
		// Antes de ler o corpo: só quem criou o plano, com o plano aberto.
		if (plan.createdBy !== user.uid) return jsonError("Só quem criou o plano pode mexer nas fotos.", 403);
		if (plan.status !== "open") return jsonError("Este plano não recebe mais mudanças.", 409);
		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return jsonError("Não foi possível ler os dados enviados.", 422, "files");
		}
		const photos = await readPhotos(form, plan.attachments.length);
		if (!photos.ok) return jsonError(photos.error, photos.status, photos.field);
		if (photos.files.length === 0) return jsonError("Escolha uma foto.", 422, "files");
		return planResponse(await addPhotos(db, getAttachmentStore(), pid, user.uid, photos.files), 201);
	} catch (err) {
		return handleError(err, "api/plans/[pid]/attachments POST");
	}
}
