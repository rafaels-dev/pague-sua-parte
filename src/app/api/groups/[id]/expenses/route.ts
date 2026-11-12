import { MULTIPART_OVERHEAD_BYTES, bodyTooLarge, handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { afterNewExpenses } from "@/lib/notifications/events";
import { getDb } from "@/lib/db/client";
import { createExpense, listExpenses } from "@/lib/expenses/repo";
import { MAX_TOTAL_BYTES, checkFileLimits, parseExpenseInput, sniffFiles } from "@/lib/expenses/validation";
import { getAttachmentStore } from "@/lib/storage/attachments";

export const dynamic = "force-dynamic";

const NOT_FOUND = "Grupo não encontrado.";
const MAX_BODY_BYTES = MAX_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id } = await params;
		const expenses = await listExpenses(await getDb(), id, user.uid);
		if (!expenses) return jsonError(NOT_FOUND, 404, undefined, "no_group");
		return Response.json({ expenses });
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses GET");
	}
}

export async function POST(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id } = await params;

		if (bodyTooLarge(request, MAX_BODY_BYTES)) return jsonError("Os anexos podem ter no máximo 4 MB no total.", 413, "files");

		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return jsonError("Não foi possível ler os dados enviados.", 422, "description");
		}

		const rawData = form.get("data");
		let json: unknown;
		try {
			json = JSON.parse(typeof rawData === "string" ? rawData : "");
		} catch {
			return jsonError("Dados inválidos.", 422, "description");
		}
		const input = parseExpenseInput(json);
		if (!input.ok) return jsonError(input.error, input.status, input.field);

		// Campo de arquivo vazio (nenhum arquivo escolhido) chega como File de 0 bytes sem nome.
		const picked = form.getAll("files").filter((f): f is File => typeof f !== "string" && !(f.size === 0 && !f.name));
		const limits = checkFileLimits(picked);
		if (limits) return jsonError(limits.error, limits.status, limits.field);
		const read = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
		const sniffed = sniffFiles(read);
		if (!sniffed.ok) return jsonError(sniffed.error, sniffed.status, sniffed.field);

		const result = await createExpense(await getDb(), getAttachmentStore(), {
			groupId: id,
			uid: user.uid,
			input: input.value,
			files: sniffed.files,
		});
		switch (result.status) {
			case "no_group":
				return jsonError(NOT_FOUND, 404, undefined, "no_group");
			case "no_pix":
				return jsonError(
					result.name
						? `Cadastre a chave Pix de ${result.name} antes de lançar uma despesa paga por ele(a).`
						: "Cadastre sua chave Pix antes de lançar uma despesa.",
					409,
					"pixKey",
				);
			case "invalid":
				return jsonError(result.error, 422, result.field);
			case "ok":
				afterNewExpenses(result.newExpense && [result.newExpense], "created");
				return Response.json(result.expense, { status: 201 });
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses POST");
	}
}
