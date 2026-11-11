import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { deleteExpense, getExpenseDetail } from "@/lib/expenses/repo";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string }> };

export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;
		const res = await getExpenseDetail(await getDb(), id, eid, user.uid);
		if (res.status === "no_group") return jsonError("Grupo não encontrado.", 404);
		if (res.status === "no_expense") return jsonError("Despesa não encontrada.", 404);
		return Response.json(res.expense);
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid] GET");
	}
}

export async function DELETE(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;
		const res = await deleteExpense(await getDb(), getAttachmentStore(), id, eid, user.uid);
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem lançou a despesa ou quem administra o grupo pode apagar.", 403);
			case "has_payment":
				return jsonError("Essa despesa já tem pagamento e não pode ser apagada.", 409);
			case "ok":
				return Response.json({ ok: true });
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid] DELETE");
	}
}
