import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { parseCreateManaged } from "@/lib/groups/managed";
import { addManagedMember, getGroupDetail } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const user = await requireUser(request);
		const { id } = await params;
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Pedido inválido.", 422, "name");
		}
		const input = parseCreateManaged(json);
		const db = await getDb();
		// Primeiro quem pergunta precisa ser admin; depois validamos os dados (não vaza nada a quem não pode).
		if (!input.ok) {
			const detail = await getGroupDetail(db, id, user.uid);
			if (!detail) return jsonError("Grupo não encontrado.", 404);
			if (detail.role !== "admin") return jsonError("Só quem administra o grupo pode fazer isso.", 403);
			return jsonError(input.error, 422, input.field);
		}
		const res = await addManagedMember(db, id, user.uid, input.value);
		switch (res.status) {
			case "not_found":
				return jsonError("Grupo não encontrado.", 404);
			case "forbidden":
				return jsonError("Só quem administra o grupo pode fazer isso.", 403);
			case "invalid":
				return jsonError(res.error, 422, res.field);
			case "full":
				return jsonError("Este grupo já está cheio.", 409);
			case "target_missing":
				return jsonError("Essa pessoa não faz mais parte do grupo.", 404);
			case "ok": {
				const detail = await getGroupDetail(db, id, user.uid);
				if (!detail) return jsonError("Grupo não encontrado.", 404);
				return Response.json(detail, { status: 201 });
			}
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/managed-members POST");
	}
}
