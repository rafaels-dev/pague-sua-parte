import { groupIdParam } from "@/lib/api/group-scope";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getPayables } from "@/lib/payments/repo";

export const dynamic = "force-dynamic";

/** Tudo o que o usuário (e quem ele cuida) pode pagar agora, por destinatário. */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		const groupId = groupIdParam(request);
		if (groupId === undefined) return Response.json(await getPayables(await getDb(), user.uid));
		const result = await getPayables(await getDb(), user.uid, undefined, groupId);
		return result ? Response.json(result) : jsonError("Grupo não encontrado.", 404);
	} catch (err) {
		return handleError(err, "api/me/payables");
	}
}
