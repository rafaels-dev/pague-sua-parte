import { MULTIPART_OVERHEAD_BYTES, bodyTooLarge, handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterPayments } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { markSelfPaid } from "@/lib/expenses/repo";
import { MAX_FILE_BYTES, type SniffedFile } from "@/lib/expenses/validation";
import { RECEIPT_TOO_BIG, readReceiptFile } from "@/lib/payments/receipt-upload";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string; uid: string }> };

const CONFLICT = "Essa despesa acabou de ser alterada. Tente de novo.";
const MAX_BODY_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;

/** "Já paguei": a pessoa que deve (ou quem age por ela) quita a própria parte, com comprovante opcional (`file`). */
export async function POST(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid, uid } = await params;

		let file: SniffedFile | undefined;
		if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
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
		}

		const res = await markSelfPaid(await getDb(), getAttachmentStore(), { groupId: id, eid, uid: user.uid, targetUid: uid, file });
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
			case "ok":
				afterPayments(res.payments);
				return Response.json(res.expense);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/shares/[uid]/payment POST");
	}
}
