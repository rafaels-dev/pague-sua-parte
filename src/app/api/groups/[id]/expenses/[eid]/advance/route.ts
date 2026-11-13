import { MULTIPART_OVERHEAD_BYTES, bodyTooLarge, handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterAdvance } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { MAX_FILE_BYTES, type SniffedFile } from "@/lib/expenses/validation";
import { advanceInstallments, getAdvancePlan } from "@/lib/payments/advance-repo";
import { ADVANCE_CONFLICT, ADVANCE_RECIPIENT_CHANGED, ADVANCE_TOO_MUCH, ADVANCE_UNCERTAIN } from "@/lib/payments/advance";
import { INVALID_AMOUNT, INVALID_REQUEST, STALE_BATCH, TOO_MANY_PARTS, readAdvanceRequest } from "@/lib/payments/amount-input";
import { RECEIPT_TOO_BIG, readReceiptFile } from "@/lib/payments/receipt-upload";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string }> };

const NOT_INSTALLMENT = "Esta despesa não é parcelada.";
const MAX_BODY_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;

/**
 * Parcelas em aberto de uma pessoa, desta parcela em diante (`?shareUid=`): é o que a tela mostra na folha "Adiantar parcelas".
 * Só para membros do grupo; "não existe" e "não é membro" devolvem o mesmo 404.
 */
export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;
		const shareUid = new URL(request.url).searchParams.get("shareUid") ?? "";
		if (shareUid.length < 1 || shareUid.length > 200) return jsonError(INVALID_REQUEST, 422, "shareUid");
		const modeParam = new URL(request.url).searchParams.get("mode") ?? "self";
		if (modeParam !== "self" && modeParam !== "manual") return jsonError(INVALID_REQUEST, 422, "mode");
		const res = await getAdvancePlan(await getDb(), id, eid, user.uid, shareUid, modeParam);
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404, undefined, "no_group");
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404, undefined, "no_expense");
			case "not_installment":
				return jsonError(NOT_INSTALLMENT, 422);
			case "forbidden":
				return jsonError("Só quem pagou a despesa ou quem administra o grupo pode marcar pagamentos.", 403);
			case "no_share":
				return jsonError("Essa pessoa não participa desta despesa.", 404);
			case "ok":
				return Response.json(res.plan, { headers: { "Cache-Control": "private, no-store" } });
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/advance GET");
	}
}

/**
 * Adianta parcelas: `shareUid`, `mode` ("self" = paguei, "manual" = recebi), `amountCents` e `expectedDueCents` (JSON, ou campos
 * de um formulário com o comprovante opcional em `file`). O cliente NUNCA manda a divisão pelas parcelas: o servidor a calcula.
 * Fica sob a despesa (e não em /api/me) porque é uma ação dentro de um grupo, com os mesmos 404 e permissões das outras rotas
 * da despesa; o lote de /api/me/payments é a visão "tudo de todos os grupos".
 */
export async function POST(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;

		let file: SniffedFile | undefined;
		let fields: Record<string, unknown> = {};
		const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
		if (contentType.startsWith("application/json")) {
			if (bodyTooLarge(request, 2_000)) return jsonError(INVALID_REQUEST, 422);
			try {
				const body: unknown = await request.json();
				fields = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
			} catch {
				return jsonError(INVALID_REQUEST, 422);
			}
		} else if (contentType.startsWith("multipart/form-data")) {
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
			fields = { shareUid: form.get("shareUid"), mode: form.get("mode"), amountCents: form.get("amountCents"), expectedDueCents: form.get("expectedDueCents"), recipientId: form.get("recipientId") };
		} else {
			return jsonError(INVALID_REQUEST, 422);
		}
		const req = readAdvanceRequest(fields);
		if (!req.ok) return jsonError(req.field === "amountCents" || req.field === "expectedDueCents" ? INVALID_AMOUNT : INVALID_REQUEST, 422, req.field);

		const res = await advanceInstallments(await getDb(), getAttachmentStore(), {
			groupId: id,
			eid,
			uid: user.uid,
			shareUid: req.shareUid,
			mode: req.mode,
			amountCents: req.amountCents,
			expectedDueCents: req.expectedDueCents,
			recipientId: req.recipientId,
			file,
		});
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404, undefined, "no_group");
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404, undefined, "no_expense");
			case "not_installment":
				return jsonError(NOT_INSTALLMENT, 422);
			case "forbidden":
				return jsonError(req.mode === "self" ? "Só quem deve pode avisar que pagou." : "Só quem pagou a despesa ou quem administra o grupo pode marcar pagamentos.", 403);
			case "no_share":
				return jsonError("Essa pessoa não participa desta despesa.", 404);
			case "conflict":
				return jsonError(ADVANCE_CONFLICT, 409);
			case "stale":
				return jsonError(STALE_BATCH, 409, "amountCents");
			case "recipient_changed":
				return jsonError(ADVANCE_RECIPIENT_CHANGED, 409, "recipientId");
			case "uncertain":
				return jsonError(ADVANCE_UNCERTAIN, 409, undefined, "advance_uncertain");
			case "invalid_amount":
				return jsonError(INVALID_AMOUNT, 422, "amountCents");
			case "too_much":
				return jsonError(ADVANCE_TOO_MUCH, 422, "amountCents");
			case "too_many_parts":
				return jsonError(TOO_MANY_PARTS, 422, "amountCents");
			case "ok":
				afterAdvance(res.fact);
				return Response.json({ expense: res.expense, advance: res.advance });
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/advance POST");
	}
}
