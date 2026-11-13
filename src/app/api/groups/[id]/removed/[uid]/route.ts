import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { allowReturnToGroup } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

/** "Permitir voltar": só administrador. Não recoloca a pessoa no grupo: ela entra de novo por um link. Idempotente. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; uid: string }> }) {
	try {
		const user = await requireUser(request);
		const { id, uid } = await params;
		const res = await allowReturnToGroup(await getDb(), id, user.uid, uid);
		if (res.status === "not_found") return jsonError("Grupo não encontrado.", 404);
		if (res.status === "forbidden") return jsonError("Só quem administra o grupo pode fazer isso.", 403);
		return Response.json({ ok: true });
	} catch (err) {
		return handleError(err, "api/groups/[id]/removed/[uid] DELETE");
	}
}
