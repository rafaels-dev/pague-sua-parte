import { handleError as sharedHandleError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { countUnseen } from "@/lib/notifications/inbox";

export const dynamic = "force-dynamic";

/** Só o contador do sininho (0 a 10). */
export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		return Response.json({ unseen: await countUnseen(await getDb(), user.uid) }, { headers: { "Cache-Control": "private, no-store" } });
	} catch (err) {
		return sharedHandleError(err, "api/me/inbox/count");
	}
}
