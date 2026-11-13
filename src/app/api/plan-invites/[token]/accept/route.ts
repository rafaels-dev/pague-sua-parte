import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { afterMemberJoined } from "@/lib/notifications/events";
import { acceptPlanInvite } from "@/lib/plans/repo";
import { upsertAndWelcome } from "@/lib/notifications/welcome";

export const dynamic = "force-dynamic";

const INVALID = "Este convite não é mais válido. Peça um novo link a quem te convidou.";
const GONE = "Este plano já virou o grupo e o link não vale mais. Peça o link do grupo a quem te convidou.";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
	try {
		const user = await requireUser(request);
		const { token } = await params;
		const db = await getDb();
		await upsertAndWelcome(db, user); // o nome aparece na lista de participantes
		const r = await acceptPlanInvite(db, token, user.uid);
		if (r.status === "invalid") return jsonError(INVALID, 404);
		if (r.status === "gone") return jsonError(GONE, 404);
		if (r.status === "group_removed") return jsonError("Você não pode entrar neste grupo. Fale com quem organiza.", 403);
		if (r.status === "group_full") return jsonError("Este grupo já está cheio.", 409);
		if (r.status === "removed") return jsonError("Você não pode entrar neste plano. Fale com quem o criou.", 403);
		if (r.status === "full") return jsonError("Este plano já tem gente demais.", 409);
		if (r.status === "group") {
			if (r.joined) afterMemberJoined(r.groupId, user.uid);
			return Response.json({ groupId: r.groupId });
		}
		return Response.json({ planId: r.planId });
	} catch (err) {
		return handleError(err, "api/plan-invites/[token]/accept");
	}
}
