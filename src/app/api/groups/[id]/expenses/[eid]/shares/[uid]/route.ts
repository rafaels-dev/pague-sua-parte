import { z } from "zod";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { setSharePaid } from "@/lib/expenses/repo";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string; uid: string }> };

const CONFLICT = "Essa despesa acabou de ser alterada. Tente de novo.";

const bodySchema = z.object({ status: z.enum(["paid", "pending"]) });

export async function PATCH(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid, uid } = await params;

		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Pedido inválido.", 422);
		}
		const parsed = bodySchema.safeParse(json);
		if (!parsed.success) return jsonError("Pedido inválido.", 422);

		const res = await setSharePaid(await getDb(), id, eid, user.uid, uid, parsed.data.status, undefined, getAttachmentStore());
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem pagou a despesa pode marcar pagamentos.", 403);
			case "no_share":
				return jsonError("Essa pessoa não participa desta despesa.", 404);
			case "conflict":
				return jsonError(CONFLICT, 409);
			case "ok":
				return Response.json(res.expense);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/shares/[uid] PATCH");
	}
}
