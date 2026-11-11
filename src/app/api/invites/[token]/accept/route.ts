import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { acceptInvite } from "@/lib/groups/repo";
import { upsertFromAuth } from "@/lib/users/repo";

export const dynamic = "force-dynamic";

const INVALID_INVITE = "Este convite não é mais válido. Peça um novo link a quem te convidou.";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
	try {
		const user = await requireUser(request);
		const { token } = await params;
		const db = await getDb();
		// Garante o documento em `users` para o nome aparecer na lista de membros.
		await upsertFromAuth(db, user);
		const result = await acceptInvite(db, token, user.uid);
		if (result.status === "invalid") {
			return jsonError(INVALID_INVITE, 404);
		}
		if (result.status === "full") return jsonError("Este grupo já está cheio.", 409);
		return Response.json({ groupId: result.groupId });
	} catch (err) {
		return handleError(err, "api/invites/[token]/accept");
	}
}
