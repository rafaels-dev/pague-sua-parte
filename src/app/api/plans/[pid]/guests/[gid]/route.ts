import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { afterPlanChange } from "@/lib/notifications/events";
import { changeFact } from "@/lib/plans/facts";
import { planResponse } from "@/lib/plans/http";
import { removeGuest } from "@/lib/plans/repo";

export const dynamic = "force-dynamic";

/** Tira uma pessoa sem celular do plano (quem a acrescentou, ou quem criou o plano). */
export async function DELETE(request: Request, { params }: { params: Promise<{ pid: string; gid: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid, gid } = await params;
		const res = await removeGuest(await getDb(), pid, user.uid, gid);
		if (res.kind === "forbidden") return jsonError("Só quem acrescentou essa pessoa, ou quem criou o plano, pode tirá-la.", 403);
		if (res.kind === "ok") afterPlanChange(changeFact(res.before, res.doc, user.uid));
		return planResponse(res);
	} catch (err) {
		return handleError(err, "api/plans/[pid]/guests/[gid] DELETE");
	}
}
