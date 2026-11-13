import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterMemberJoined } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { acceptInvite } from "@/lib/groups/repo";
import { upsertAndWelcome } from "@/lib/notifications/welcome";

export const dynamic = "force-dynamic";

const INVALID_INVITE = "Este convite não é mais válido. Peça um novo link a quem te convidou.";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
	try {
		const user = await requireUser(request);
		const { token } = await params;
		const db = await getDb();
		// Garante o documento em `users` para o nome aparecer na lista de membros.
		await upsertAndWelcome(db, user);
		const result = await acceptInvite(db, token, user.uid);
		if (result.status === "invalid") {
			return jsonError(INVALID_INVITE, 404);
		}
		if (result.status === "removed") return jsonError("Você não pode entrar neste grupo. Fale com quem organiza.", 403);
		if (result.status === "full") return jsonError("Este grupo já está cheio.", 409);
		if (result.joined) afterMemberJoined(result.groupId, user.uid);
		return Response.json({ groupId: result.groupId });
	} catch (err) {
		return handleError(err, "api/invites/[token]/accept");
	}
}
