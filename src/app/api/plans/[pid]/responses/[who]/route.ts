import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { afterPlanChange } from "@/lib/notifications/events";
import { changeFact } from "@/lib/plans/facts";
import { PLAN_NOT_FOUND, planResponse } from "@/lib/plans/http";
import { getPlanView, setResponse } from "@/lib/plans/repo";
import { parseResponseInput } from "@/lib/plans/validation";

export const dynamic = "force-dynamic";

/** "Vou" (com limite opcional) ou "Não vou", por si ou por uma pessoa sem celular que você acrescentou. */
export async function PUT(request: Request, { params }: { params: Promise<{ pid: string; who: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid, who } = await params;
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Dados inválidos.", 422, "going");
		}
		const input = parseResponseInput(json);
		const db = await getDb();
		if (!input.ok) return (await getPlanView(db, pid, user.uid)) ? jsonError(input.error, input.status, input.field) : jsonError(PLAN_NOT_FOUND, 404);
		const res = await setResponse(db, pid, user.uid, who, input.value);
		if (res.kind === "forbidden") return jsonError("Você só responde por você e por quem você acrescentou.", 403);
		if (res.kind === "ok") afterPlanChange(changeFact(res.before, res.doc, user.uid));
		return planResponse(res);
	} catch (err) {
		return handleError(err, "api/plans/[pid]/responses/[who] PUT");
	}
}
