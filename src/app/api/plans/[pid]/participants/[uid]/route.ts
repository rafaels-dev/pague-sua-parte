import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { afterPlanChange } from "@/lib/notifications/events";
import { changeFact } from "@/lib/plans/facts";
import { planResponse } from "@/lib/plans/http";
import { removeParticipant } from "@/lib/plans/repo";

export const dynamic = "force-dynamic";

/** Quem criou o plano tira um participante; cada participante pode sair. */
export async function DELETE(request: Request, { params }: { params: Promise<{ pid: string; uid: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid, uid } = await params;
		const res = await removeParticipant(await getDb(), pid, user.uid, uid);
		if (res.kind === "forbidden") return jsonError("Quem criou o plano não pode sair dele, e só ele tira os outros.", 403);
		if (res.kind === "ok") afterPlanChange(changeFact(res.before, res.doc, user.uid));
		if (res.kind === "ok" && uid === user.uid) return Response.json({ left: true });
		return planResponse(res);
	} catch (err) {
		return handleError(err, "api/plans/[pid]/participants/[uid] DELETE");
	}
}
