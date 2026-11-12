import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterNewExpenses } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { updateParticipants } from "@/lib/expenses/repo";
import { parseParticipantsInput } from "@/lib/expenses/validation";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string }> };

export async function PUT(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;

		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Escolha quem divide a despesa.", 422, "participantUids");
		}
		const input = parseParticipantsInput(json);
		if (!input.ok) return jsonError(input.error, input.status, input.field);

		const res = await updateParticipants(await getDb(), id, eid, user.uid, input.value, input.scope, undefined, getAttachmentStore());
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem pagou a despesa ou quem administra o grupo pode mudar quem divide.", 403);
			case "invalid":
				return jsonError(res.error, 422, res.field);
			case "conflict":
				return jsonError("Essa despesa acabou de ser alterada. Tente de novo.", 409);
			case "ok":
				afterNewExpenses(res.newExpense && [res.newExpense], "added");
				return Response.json(res.expense);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/participants PUT");
	}
}
