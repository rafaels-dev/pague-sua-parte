import { z } from "zod";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterPayments } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { setSharePaid } from "@/lib/expenses/repo";
import { amountRejectionResponse, hasKey, INVALID_AMOUNT, readPartialRequest } from "@/lib/payments/amount-input";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string; uid: string }> };

const CONFLICT = "Essa despesa acabou de ser alterada. Tente de novo.";

// `amountCents` (opcional, só com "paid"): "Recebi só uma parte". Ausente = recebeu o que falta. A conferência do valor é do servidor, na hora de gravar.
const bodySchema = z.object({ status: z.enum(["paid", "pending"]), amountCents: z.unknown().optional(), expectedPaidCents: z.unknown().optional() });

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

		const present = { amountCents: hasKey(json, "amountCents"), expectedPaidCents: hasKey(json, "expectedPaidCents") };
		const amount = readPartialRequest(parsed.data, present, parsed.data.status === "paid" ? "pay" : "undo");
		if (!amount.ok) return jsonError(INVALID_AMOUNT, 422, "amountCents");

		const res = await setSharePaid(await getDb(), id, eid, user.uid, uid, parsed.data.status, undefined, getAttachmentStore(), amount.amountCents, amount.expectedPaidCents);
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404, undefined, "no_group");
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404, undefined, "no_expense");
			case "forbidden":
				return jsonError("Só quem pagou a despesa ou quem administra o grupo pode marcar pagamentos.", 403);
			case "no_share":
				return jsonError("Essa pessoa não participa desta despesa.", 404);
			case "conflict":
				return jsonError(CONFLICT, 409);
			case "invalid_amount":
			case "too_much":
			case "too_many_parts":
			case "stale":
			case "stale_undo":
				return amountRejectionResponse(res.status);
			case "ok":
				afterPayments(res.payments);
				return Response.json(res.expense);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/shares/[uid] PATCH");
	}
}
