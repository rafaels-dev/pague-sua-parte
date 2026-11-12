import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterNewExpenses } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { deleteExpense, editExpense, getExpenseDetail } from "@/lib/expenses/repo";
import { parseExpenseEdit, parseScope } from "@/lib/expenses/validation";
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

export async function PATCH(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Dados inválidos.", 422, "description");
		}
		const input = parseExpenseEdit(json);
		if (!input.ok) return jsonError(input.error, input.status, input.field);
		const res = await editExpense(await getDb(), getAttachmentStore(), { groupId: id, eid, uid: user.uid, input: input.value });
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem pagou a despesa ou quem administra o grupo pode editar.", 403);
			case "invalid":
				return jsonError(res.error, 422, res.field);
			case "conflict":
				return jsonError("Essa despesa acabou de ser alterada. Tente de novo.", 409);
			case "ok":
				afterNewExpenses(res.newExpense && [res.newExpense], "added");
				return Response.json(res.expense);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid] PATCH");
	}
}

export async function DELETE(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;
		const scope = parseScope(new URL(request.url).searchParams.get("scope"));
		if (!scope) return jsonError("Escopo inválido.", 422, "scope");
		const res = await deleteExpense(await getDb(), getAttachmentStore(), id, eid, user.uid, scope);
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
				return Response.json({ ok: true, deleted: res.deleted, kept: res.kept });
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid] DELETE");
	}
}
