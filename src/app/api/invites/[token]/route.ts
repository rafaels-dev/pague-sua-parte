import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { previewInvite } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

const INVALID_INVITE = "Este convite não é mais válido. Peça um novo link a quem te convidou.";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
	try {
		const user = await requireUser(request);
		const { token } = await params;
		const preview = await previewInvite(await getDb(), token, user.uid);
		if (!preview) return jsonError(INVALID_INVITE, 404);
		return Response.json(preview);
	} catch (err) {
		return handleError(err, "api/invites/[token]");
	}
}
