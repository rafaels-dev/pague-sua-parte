import { handleError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getReceivables } from "@/lib/payments/repo";

export const dynamic = "force-dynamic";

/** Tudo o que ainda devem ao usuário (e a quem ele cuida), por devedor. */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		return Response.json(await getReceivables(await getDb(), user.uid));
	} catch (err) {
		return handleError(err, "api/me/receivables");
	}
}
