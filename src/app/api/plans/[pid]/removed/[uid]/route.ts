import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { planResponse } from "@/lib/plans/http";
import { allowReturn } from "@/lib/plans/repo";

export const dynamic = "force-dynamic";

/** "Permitir voltar": só quem criou o plano, com o plano aberto. Não recoloca a pessoa: ela entra de novo pelo link. */
export async function DELETE(request: Request, { params }: { params: Promise<{ pid: string; uid: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid, uid } = await params;
		const res = await allowReturn(await getDb(), pid, user.uid, uid);
		if (res.kind === "forbidden") return jsonError("Só quem criou o plano pode fazer isso.", 403);
		return planResponse(res);
	} catch (err) {
		return handleError(err, "api/plans/[pid]/removed/[uid] DELETE");
	}
}
