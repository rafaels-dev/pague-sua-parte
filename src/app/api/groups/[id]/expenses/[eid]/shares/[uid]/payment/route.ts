import { MULTIPART_OVERHEAD_BYTES, bodyTooLarge, handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterPayments } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { markSelfPaid } from "@/lib/expenses/repo";
import { MAX_FILE_BYTES, type SniffedFile } from "@/lib/expenses/validation";
import { amountRejectionResponse, hasKey, INVALID_AMOUNT, INVALID_REQUEST, readPartialRequest } from "@/lib/payments/amount-input";
import { RECEIPT_TOO_BIG, readReceiptFile } from "@/lib/payments/receipt-upload";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string; uid: string }> };

const CONFLICT = "Essa despesa acabou de ser alterada. Tente de novo.";
const MAX_BODY_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;

/**
 * "Já paguei": a pessoa que deve (ou quem age por ela) quita a própria parte, com comprovante opcional (`file`).
 * Com `amountCents` (campo do formulário ou JSON `{ "amountCents": 4700 }`) paga só esse pedaço: a parte continua em aberto.
 * Sem `amountCents` o comportamento é o de sempre (quita o que falta).
 */
export async function POST(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid, uid } = await params;

		let file: SniffedFile | undefined;
		let fields: { amountCents?: unknown; expectedPaidCents?: unknown } = {};
		let present = { amountCents: false, expectedPaidCents: false };
		const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
		if (contentType.startsWith("application/json")) {
			if (bodyTooLarge(request, 2_000)) return jsonError(INVALID_REQUEST, 422);
			try {
				const body = (await request.json()) as { amountCents?: unknown; expectedPaidCents?: unknown } | null;
				fields = body && typeof body === "object" ? body : {};
				present = { amountCents: hasKey(body, "amountCents"), expectedPaidCents: hasKey(body, "expectedPaidCents") };
			} catch {
				return jsonError(INVALID_REQUEST, 422);
			}
		} else if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
			if (bodyTooLarge(request, MAX_BODY_BYTES)) return jsonError(RECEIPT_TOO_BIG, 422, "file");
			let form: FormData;
			try {
				form = await request.formData();
			} catch {
				return jsonError("Não foi possível ler o comprovante enviado.", 422, "file");
			}
			const read = await readReceiptFile(form);
			if (!read.ok) return jsonError(read.error, 422, "file");
			file = read.file;
			fields = { amountCents: form.get("amountCents"), expectedPaidCents: form.get("expectedPaidCents") };
			present = { amountCents: form.has("amountCents"), expectedPaidCents: form.has("expectedPaidCents") };
		}
		const amountRead = readPartialRequest(fields, present, "pay");
		if (!amountRead.ok) return jsonError(INVALID_AMOUNT, 422, "amountCents");

		const res = await markSelfPaid(await getDb(), getAttachmentStore(), { groupId: id, eid, uid: user.uid, targetUid: uid, file, amountCents: amountRead.amountCents, expectedPaidCents: amountRead.expectedPaidCents });
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404, undefined, "no_group");
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404, undefined, "no_expense");
			case "forbidden":
				return jsonError("Só quem deve pode avisar que pagou.", 403);
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
		return handleError(err, "api/groups/[id]/expenses/[eid]/shares/[uid]/payment POST");
	}
}
