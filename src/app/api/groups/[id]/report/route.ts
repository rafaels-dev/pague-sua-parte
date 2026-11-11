import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { parsePeriod } from "@/lib/reports/period";
import { getGroupReport } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id } = await params;
		const period = parsePeriod(new URL(request.url).searchParams.get("period"));
		if (!period) return jsonError("Período inválido. Use all, month:AAAA-MM ou year:AAAA.", 422, "period");
		const res = await getGroupReport(await getDb(), id, user.uid, period);
		if (res.status === "no_group") return jsonError("Grupo não encontrado.", 404);
		return Response.json(res.report);
	} catch (err) {
		return handleError(err, "api/groups/[id]/report GET");
	}
}
