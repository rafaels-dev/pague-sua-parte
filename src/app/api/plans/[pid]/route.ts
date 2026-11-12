import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { afterPlanCancelled, afterPlanChange } from "@/lib/notifications/events";
import { changeFact, goingIdsOf, noticeBase } from "@/lib/plans/facts";
import { PLAN_NOT_FOUND, planResponse } from "@/lib/plans/http";
import { cancelPlan, getPlanView, updatePlan } from "@/lib/plans/repo";
import { parsePlanInput } from "@/lib/plans/validation";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pid: string }> };

export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { pid } = await params;
		const view = await getPlanView(await getDb(), pid, user.uid);
		return view ? Response.json(view) : jsonError(PLAN_NOT_FOUND, 404);
	} catch (err) {
		return handleError(err, "api/plans/[pid] GET");
	}
}

/** Editar nome, valor, datas, detalhes e previsão de pessoas (só quem criou, com o plano aberto). */
export async function PATCH(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { pid } = await params;
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Dados inválidos.", 422, "name");
		}
		const input = parsePlanInput(json);
		const db = await getDb();
		// Só mostra erro de validação a quem participa do plano.
		if (!input.ok) return (await getPlanView(db, pid, user.uid)) ? jsonError(input.error, input.status, input.field) : jsonError(PLAN_NOT_FOUND, 404);
		const res = await updatePlan(db, pid, user.uid, input.value);
		if (res.kind === "ok") afterPlanChange(changeFact(res.before, res.doc, user.uid));
		return planResponse(res);
	} catch (err) {
		return handleError(err, "api/plans/[pid] PATCH");
	}
}

/** Cancelar o plano (fica visível como cancelado). */
export async function DELETE(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { pid } = await params;
		const res = await cancelPlan(await getDb(), getAttachmentStore(), pid, user.uid);
		if (res.kind === "ok") afterPlanCancelled({ ...noticeBase(res.before, user.uid), goingIds: goingIdsOf(res.before) });
		return planResponse(res);
	} catch (err) {
		return handleError(err, "api/plans/[pid] DELETE");
	}
}
