import { MULTIPART_OVERHEAD_BYTES, bodyTooLarge, handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { MAX_TOTAL_BYTES } from "@/lib/expenses/validation";
import { readPhotos } from "@/lib/plans/http";
import { createPlan, hasOldPlans, listPlans } from "@/lib/plans/repo";
import { parsePlanInput } from "@/lib/plans/validation";
import { getAttachmentStore } from "@/lib/storage/attachments";
import { upsertAndWelcome } from "@/lib/notifications/welcome";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = MAX_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES;

/** Planos de quem está logado. `?escopo=antigos` traz os fechados e cancelados; sem ele vem também `hasOld` (há planos antigos?). */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		const antigos = new URL(request.url).searchParams.get("escopo") === "antigos";
		const db = await getDb();
		if (antigos) return Response.json({ plans: await listPlans(db, user.uid, "old") });
		// `hasOld` deixa o início mostrar "Ver planos antigos" só para quem tem algum.
		const [plans, hasOld] = await Promise.all([listPlans(db, user.uid, "open"), hasOldPlans(db, user.uid)]);
		return Response.json({ plans, hasOld });
	} catch (err) {
		return handleError(err, "api/plans GET");
	}
}

export async function POST(request: Request) {
	try {
		const user = await requireUser(request);
		if (bodyTooLarge(request, MAX_BODY_BYTES)) return jsonError("As fotos podem ter no máximo 4 MB no total.", 413, "files");
		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return jsonError("Não foi possível ler os dados enviados.", 422, "name");
		}
		const raw = form.get("data");
		let json: unknown;
		try {
			json = JSON.parse(typeof raw === "string" ? raw : "");
		} catch {
			return jsonError("Dados inválidos.", 422, "name");
		}
		const input = parsePlanInput(json);
		if (!input.ok) return jsonError(input.error, input.status, input.field);
		const photos = await readPhotos(form);
		if (!photos.ok) return jsonError(photos.error, photos.status, photos.field);

		const db = await getDb();
		await upsertAndWelcome(db, user); // o nome aparece na lista de participantes
		return Response.json(await createPlan(db, getAttachmentStore(), user.uid, input.value, photos.files), { status: 201 });
	} catch (err) {
		return handleError(err, "api/plans POST");
	}
}
