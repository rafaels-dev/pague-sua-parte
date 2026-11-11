import { handleError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getSummary } from "@/lib/expenses/repo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		return Response.json(await getSummary(await getDb(), user.uid));
	} catch (err) {
		return handleError(err, "api/me/summary");
	}
}
