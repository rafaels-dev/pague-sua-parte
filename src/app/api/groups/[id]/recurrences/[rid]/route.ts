import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { endRecurrence, updateRecurrence } from "@/lib/recurrences/repo";
import { parseRecurrencePatch } from "@/lib/recurrences/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; rid: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, rid } = await params;
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Dados inválidos.", 422, "description");
		}
		const patch = parseRecurrencePatch(json);
		if (!patch.ok) return jsonError(patch.error, patch.status, patch.field);
		const res = await updateRecurrence(await getDb(), { groupId: id, rid, uid: user.uid, patch: patch.value });
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_recurrence":
				return jsonError("Despesa fixa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem paga essa despesa ou quem administra o grupo pode alterar.", 403);
			case "invalid":
				return jsonError(res.error, 422, res.field);
			case "ok":
				return Response.json(res.recurrence);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/recurrences/[rid] PATCH");
	}
}

export async function DELETE(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, rid } = await params;
		const res = await endRecurrence(await getDb(), { groupId: id, rid, uid: user.uid });
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_recurrence":
				return jsonError("Despesa fixa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem paga essa despesa ou quem administra o grupo pode encerrar.", 403);
			case "ok":
				return Response.json({ ok: true });
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/recurrences/[rid] DELETE");
	}
}
