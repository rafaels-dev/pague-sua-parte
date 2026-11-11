import { groupIdParam } from "@/lib/api/group-scope";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getSummary } from "@/lib/expenses/repo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		const groupId = groupIdParam(request);
		if (groupId === undefined) return Response.json(await getSummary(await getDb(), user.uid));
		const summary = await getSummary(await getDb(), user.uid, undefined, groupId);
		return summary ? Response.json(summary) : jsonError("Grupo não encontrado.", 404);
	} catch (err) {
		return handleError(err, "api/me/summary");
	}
}
