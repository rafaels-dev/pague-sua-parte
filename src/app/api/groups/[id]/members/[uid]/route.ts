import { z } from "zod";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { removeMember, setMemberRole, type MemberActionResult } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; uid: string }> };

const removeSchema = z.object({ allowReturn: z.boolean().optional() });
const bodySchema = z.object({ role: z.enum(["admin", "member"]) });

function joinNames(names: string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Respostas de falha comuns às duas ações; null quando deu certo. */
function failure(result: MemberActionResult, selfMessage: string) {
	switch (result.status) {
		case "not_found":
			return jsonError("Grupo não encontrado.", 404);
		case "forbidden":
			return jsonError("Só quem administra o grupo pode fazer isso.", 403);
		case "self":
			return jsonError(selfMessage, 409);
		case "target_missing":
			return jsonError("Essa pessoa não faz mais parte do grupo.", 404);
		case "managed_target":
			return jsonError("Pessoas sem celular não podem administrar o grupo.", 409);
		case "responsible":
			return jsonError(`${result.name} cuida de ${joinNames(result.managed)}. Troque o responsável antes de remover.`, 409);
		default:
			return null;
	}
}

export async function PATCH(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, uid } = await params;

		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Pedido inválido.", 422);
		}
		const parsed = bodySchema.safeParse(json);
		if (!parsed.success) return jsonError("Pedido inválido.", 422);

		const { role } = parsed.data;
		const result = await setMemberRole(await getDb(), id, user.uid, uid, role);
		return failure(result, "Você não pode alterar o seu próprio papel.") ?? Response.json({ uid, role });
	} catch (err) {
		return handleError(err, "api/groups/[id]/members/[uid]");
	}
}

export async function DELETE(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, uid } = await params;
		// Corpo opcional: `allowReturn` (ausente = true; cliente antigo segue valendo). Valor que não é booleano = 422.
		let allowReturn = true;
		const raw = await request.text();
		if (raw.trim()) {
			let json: unknown;
			try {
				json = JSON.parse(raw);
			} catch {
				return jsonError("Pedido inválido.", 422);
			}
			const parsed = removeSchema.safeParse(json);
			if (!parsed.success) return jsonError("Pedido inválido.", 422);
			allowReturn = parsed.data.allowReturn ?? true;
		}
		const result = await removeMember(await getDb(), id, user.uid, uid, allowReturn);
		return failure(result, "Você não pode remover a si mesmo do grupo.") ?? Response.json({ ok: true });
	} catch (err) {
		return handleError(err, "api/groups/[id]/members/[uid]");
	}
}
