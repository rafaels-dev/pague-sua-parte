import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { previewPlanInvite } from "@/lib/plans/repo";

export const dynamic = "force-dynamic";

export const INVALID_PLAN_INVITE = "Este convite não é mais válido. Peça um novo link a quem te convidou.";
export const PLAN_LINK_GONE = "Este plano já virou o grupo e o link não vale mais. Peça o link do grupo a quem te convidou.";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
	try {
		const user = await requireUser(request);
		const { token } = await params;
		const preview = await previewPlanInvite(await getDb(), token, user.uid);
		if (!preview) return jsonError(INVALID_PLAN_INVITE, 404);
		if ("gone" in preview) return jsonError(PLAN_LINK_GONE, 404);
		return Response.json(preview);
	} catch (err) {
		return handleError(err, "api/plan-invites/[token]");
	}
}
