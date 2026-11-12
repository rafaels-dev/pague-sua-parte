import { jsonError } from "@/lib/api/http";
import { checkFileLimits, sniffFiles, type Invalid, type SniffedFile } from "@/lib/expenses/validation";
import { MAX_PLAN_PHOTOS } from "./collection";
import type { PlanChange } from "./repo";

export const PLAN_NOT_FOUND = "Plano não encontrado.";

/** Resposta padrão de uma mudança no plano; `ok` devolve a visão do plano para quem chamou. */
export function planResponse(c: PlanChange, status = 200): Response {
	switch (c.kind) {
		case "ok":
			return Response.json(c.view, { status });
		case "no_plan":
			return jsonError(PLAN_NOT_FOUND, 404);
		case "forbidden":
			return jsonError("Só quem criou o plano pode fazer isso.", 403);
		case "closed":
			return jsonError("Este plano não recebe mais mudanças.", 409);
		case "conflict":
			return jsonError("O plano mudou enquanto você mexia. Tente de novo.", 409);
		case "limit":
			return jsonError("Não dá para acrescentar mais pessoas.", 409, "name");
		case "too_many":
			return jsonError(`O plano pode ter até ${MAX_PLAN_PHOTOS} fotos.`, 422, "files");
	}
}

/** Fotos enviadas num formulário: até 3, só imagem (JPG, PNG, WebP), pelo conteúdo e não pelo nome. */
export async function readPhotos(form: FormData, alreadyHave = 0): Promise<{ ok: true; files: SniffedFile[] } | Invalid> {
	// Campo de arquivo vazio (nenhum arquivo escolhido) chega como File de 0 bytes sem nome.
	const picked = form.getAll("files").filter((f): f is File => typeof f !== "string" && !(f.size === 0 && !f.name));
	if (alreadyHave + picked.length > MAX_PLAN_PHOTOS) return { ok: false, status: 422, error: `O plano pode ter até ${MAX_PLAN_PHOTOS} fotos.`, field: "files" };
	const limits = checkFileLimits(picked);
	if (limits) return limits;
	const read = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
	const sniffed = sniffFiles(read);
	if (!sniffed.ok) return sniffed;
	if (sniffed.files.some((f) => f.contentType === "application/pdf")) return { ok: false, status: 415, error: "Só aceitamos foto (JPG, PNG ou WebP).", field: "files" };
	return sniffed;
}
