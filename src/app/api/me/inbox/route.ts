import { handleError as sharedHandleError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { listInbox } from "@/lib/notifications/inbox";

export const dynamic = "force-dynamic";

/** Os 30 avisos mais recentes da própria pessoa e quantos ainda não foram vistos (0 a 10). */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		const data = await listInbox(await getDb(), user.uid);
		return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
	} catch (err) {
		return sharedHandleError(err, "api/me/inbox");
	}
}
