import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getGroupSummary } from "@/lib/expenses/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Resumo do grupo inteiro (quem deve a quem), igual para qualquer membro. Só membros; sem chaves Pix. */
export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id } = await params;
		const summary = await getGroupSummary(await getDb(), id, user.uid);
		return summary ? Response.json(summary) : jsonError("Grupo não encontrado.", 404);
	} catch (err) {
		return handleError(err, "api/groups/[id]/summary GET");
	}
}
