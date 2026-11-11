import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { markSelfPaid } from "@/lib/expenses/repo";
import { MAX_FILE_BYTES, sniffFiles, type SniffedFile } from "@/lib/expenses/validation";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string; uid: string }> };

const CONFLICT = "Essa despesa acabou de ser alterada. Tente de novo.";
/** Folga para o corpo multipart além do arquivo. */
const MAX_BODY_BYTES = MAX_FILE_BYTES + 256 * 1024;

/** "Já paguei": a pessoa que deve (ou quem age por ela) quita a própria parte, com comprovante opcional (`file`). */
export async function POST(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid, uid } = await params;

		const declared = Number(request.headers.get("content-length"));
		if (declared > MAX_BODY_BYTES) return jsonError("O comprovante pode ter no máximo 5 MB.", 422, "file");

		let file: SniffedFile | undefined;
		if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
			let form: FormData;
			try {
				form = await request.formData();
			} catch {
				return jsonError("Não foi possível ler o comprovante enviado.", 422, "file");
			}
			const picked = form.getAll("file");
			// Campo de arquivo vazio (nenhum arquivo escolhido) chega como File de 0 bytes sem nome: vale como "sem arquivo".
			const files = picked.filter((f): f is File => typeof f !== "string" && !(f.size === 0 && !f.name));
			if (picked.some((f) => typeof f === "string" && f !== "") || files.length > 1) {
				return jsonError("Envie um único comprovante.", 422, "file");
			}
			if (files.length === 1) {
				if (files[0].size > MAX_FILE_BYTES) return jsonError("O comprovante pode ter no máximo 5 MB.", 422, "file");
				const bytes = new Uint8Array(await files[0].arrayBuffer());
				const sniffed = sniffFiles([{ name: files[0].name, bytes }]);
				if (!sniffed.ok) {
					const msg = sniffed.status === 415 ? "Só aceitamos foto (JPG, PNG, WebP) ou PDF." : "O comprovante pode ter no máximo 5 MB.";
					return jsonError(msg, 422, "file");
				}
				file = sniffed.files[0];
			}
		}

		const res = await markSelfPaid(await getDb(), getAttachmentStore(), { groupId: id, eid, uid: user.uid, targetUid: uid, file });
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404);
			case "forbidden":
				return jsonError("Só quem deve pode avisar que pagou.", 403);
			case "no_share":
				return jsonError("Essa pessoa não participa desta despesa.", 404);
			case "conflict":
				return jsonError(CONFLICT, 409);
			case "ok":
				return Response.json(res.expense);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/shares/[uid]/payment POST");
	}
}
