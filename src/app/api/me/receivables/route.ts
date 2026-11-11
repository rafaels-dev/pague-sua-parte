import { groupIdParam } from "@/lib/api/group-scope";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getReceivables } from "@/lib/payments/repo";

export const dynamic = "force-dynamic";

/** Tudo o que ainda devem ao usuário (e a quem ele cuida), por devedor. */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		const groupId = groupIdParam(request);
		if (groupId === undefined) return Response.json(await getReceivables(await getDb(), user.uid));
		const result = await getReceivables(await getDb(), user.uid, undefined, groupId);
		return result ? Response.json(result) : jsonError("Grupo não encontrado.", 404);
	} catch (err) {
		return handleError(err, "api/me/receivables");
	}
}
