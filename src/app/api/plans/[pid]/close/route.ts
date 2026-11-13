import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { closePlan } from "@/lib/plans/close";
import { noticeBase } from "@/lib/plans/facts";
import { PLAN_NOT_FOUND } from "@/lib/plans/http";
import { afterPlanClosed, afterPlanConfirmed } from "@/lib/notifications/events";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

/** "Criar grupo e despesa": só quem criou o plano. Devolve `{ groupId, expenseId }`. */
export async function POST(request: Request, { params }: { params: Promise<{ pid: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid } = await params;
		let json: unknown = null;
		try {
			json = await request.json();
		} catch {
			// a validação responde
		}
		const r = await closePlan(await getDb(), getAttachmentStore(), user.uid, pid, json);
		switch (r.status) {
			case "no_plan":
				return jsonError(PLAN_NOT_FOUND, 404);
			case "forbidden":
				return jsonError("Só quem criou o plano pode criar o grupo e a despesa.", 403);
			case "not_open":
				return jsonError("Este plano já foi fechado ou cancelado.", 409);
			case "conflict":
				return jsonError("Não foi possível criar agora. Tente de novo.", 409);
			case "invalid":
				return jsonError(r.error, 422, r.field);
			case "no_pix":
				return jsonError(
					r.name ? `Cadastre a chave Pix de ${r.name} antes de criar a despesa paga por ele(a).` : "Cadastre sua chave Pix antes de criar a despesa.",
					409,
					"pixKey",
				);
			case "ok":
				afterPlanConfirmed({ planName: r.doc.name, groupName: r.doc.groupName ?? r.doc.name, groupId: r.groupId, actorUid: user.uid }, r.newExpense);
				afterPlanClosed({ ...noticeBase(r.doc, user.uid), leftOutIds: r.notChosenGoing });
				return Response.json({ groupId: r.groupId, expenseId: r.expenseId }, { status: 201 });
		}
	} catch (err) {
		return handleError(err, "api/plans/[pid]/close POST");
	}
}
