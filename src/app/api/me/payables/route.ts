import { handleError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getPayables } from "@/lib/payments/repo";

export const dynamic = "force-dynamic";

/** Tudo o que o usuário (e quem ele cuida) pode pagar agora, por destinatário. */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		return Response.json(await getPayables(await getDb(), user.uid));
	} catch (err) {
		return handleError(err, "api/me/payables");
	}
}
