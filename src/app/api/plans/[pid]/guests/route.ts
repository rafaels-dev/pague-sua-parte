import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { PLAN_NOT_FOUND, planResponse } from "@/lib/plans/http";
import { addGuest, getPlanView } from "@/lib/plans/repo";
import { parseGuestName } from "@/lib/plans/validation";

export const dynamic = "force-dynamic";

/** "Também respondo por": acrescenta uma pessoa sem celular (só o nome). */
export async function POST(request: Request, { params }: { params: Promise<{ pid: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid } = await params;
		let json: unknown = null;
		try {
			json = await request.json();
		} catch {
			// segue com null: a validação responde
		}
		const name = parseGuestName(json);
		const db = await getDb();
		if (!name.ok) return (await getPlanView(db, pid, user.uid)) ? jsonError(name.error, name.status, name.field) : jsonError(PLAN_NOT_FOUND, 404);
		return planResponse(await addGuest(db, pid, user.uid, name.value), 201);
	} catch (err) {
		return handleError(err, "api/plans/[pid]/guests POST");
	}
}
