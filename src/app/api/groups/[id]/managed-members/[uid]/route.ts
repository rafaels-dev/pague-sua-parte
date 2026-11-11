import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { parsePatchManaged } from "@/lib/groups/managed";
import { getGroupDetail, updateManagedMember } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; uid: string }> }) {
	try {
		const user = await requireUser(request);
		const { id, uid } = await params;
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Pedido inválido.", 422, "name");
		}
		const input = parsePatchManaged(json);
		const db = await getDb();
		if (!input.ok) {
			// Só mostra o erro de validação a quem é membro.
			if (!(await getGroupDetail(db, id, user.uid))) return jsonError("Grupo não encontrado.", 404);
			return jsonError(input.error, 422, input.field);
		}
		const res = await updateManagedMember(db, id, user.uid, uid, input.value);
		switch (res.status) {
			case "not_found":
				return jsonError("Grupo não encontrado.", 404);
			case "target_missing":
				return jsonError("Essa pessoa não faz mais parte do grupo.", 404);
			case "forbidden":
				return jsonError("Só quem administra o grupo ou cuida dessa pessoa pode fazer isso.", 403);
			case "invalid":
				return jsonError(res.error, 422, res.field);
			case "full":
				return jsonError("Este grupo já está cheio.", 409);
			case "ok": {
				const detail = await getGroupDetail(db, id, user.uid);
				if (!detail) return jsonError("Grupo não encontrado.", 404);
				return Response.json(detail);
			}
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/managed-members/[uid] PATCH");
	}
}
