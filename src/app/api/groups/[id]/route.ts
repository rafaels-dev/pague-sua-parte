import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getGroupDetail } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const user = await requireUser(request);
		const { id } = await params;
		const group = await getGroupDetail(await getDb(), id, user.uid);
		if (!group) return jsonError("Grupo não encontrado.", 404);
		return Response.json(group);
	} catch (err) {
		return handleError(err, "api/groups/[id]");
	}
}
