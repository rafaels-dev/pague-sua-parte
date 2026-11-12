import { z } from "zod";
import { MULTIPART_OVERHEAD_BYTES, bodyTooLarge, handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { MAX_FILE_BYTES, type SniffedFile } from "@/lib/expenses/validation";
import { payBatch } from "@/lib/payments/repo";
import { RECEIPT_TOO_BIG, readReceiptFile } from "@/lib/payments/receipt-upload";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;
const MAX_JSON_CHARS = 64 * 1024;
const BAD_ITEMS = "Escolha de 1 a 50 contas, sem repetir.";

const hex24 = z.string().regex(/^[0-9a-f]{24}$/i);
const bodySchema = z.object({
	items: z
		.array(z.object({ groupId: hex24, expenseId: hex24, shareUid: z.string().min(1).max(200), kind: z.enum(["share", "refund"]).optional() }))
		.min(1)
		.max(50),
	/** Id do destinatário como a tela o recebeu em "contas a pagar"; recusa o lote se a chave Pix mudou depois. */
	recipientId: z.string().regex(/^r_[0-9a-f]{24}$/).optional(),
});

/** "Pagar tudo de uma vez": quita várias cotas do mesmo destinatário com um comprovante opcional (`file`). */
export async function POST(request: Request) {
	try {
		const user = await requireUser(request);

		let raw: string | null = null;
		let file: SniffedFile | undefined;
		if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
			if (bodyTooLarge(request, MAX_BODY_BYTES)) return jsonError(RECEIPT_TOO_BIG, 422, "file");
			let form: FormData;
			try {
				form = await request.formData();
			} catch {
				return jsonError("Não foi possível ler o comprovante enviado.", 422, "file");
			}
			const data = form.get("data");
			raw = typeof data === "string" ? data : null;
			const read = await readReceiptFile(form);
			if (!read.ok) return jsonError(read.error, 422, "file");
			file = read.file;
		} else {
			const text = await request.text().catch(() => "");
			raw = text.length <= MAX_JSON_CHARS ? text : null;
		}

		let json: unknown;
		try {
			json = JSON.parse(raw ?? "");
		} catch {
			return jsonError(BAD_ITEMS, 422, "items");
		}
		const parsed = bodySchema.safeParse(json);
		if (!parsed.success) return jsonError(BAD_ITEMS, 422, "items");
		const items = parsed.data.items;

		const res = await payBatch(await getDb(), getAttachmentStore(), { uid: user.uid, items, file, recipientId: parsed.data.recipientId });
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem deve pode avisar que pagou.", 403);
			case "no_share":
				return jsonError("Essa pessoa não participa desta despesa.", 404);
			case "invalid":
				return jsonError(res.error, 422, res.field);
			case "all_failed":
				return jsonError("Essas contas acabaram de mudar. Atualize e tente de novo.", 409);
			case "ok": {
				const { batchId, paid, failed, totalPaidCents, hasReceipt } = res;
				return Response.json({ batchId, paid, failed, totalPaidCents, hasReceipt });
			}
		}
	} catch (err) {
		return handleError(err, "api/me/payments POST");
	}
}
