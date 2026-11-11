import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { helpExpense } from "@/lib/expenses/repo";
import { parseHelpInput } from "@/lib/expenses/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string }> };

export async function POST(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id, eid } = await params;

		let json: unknown = {};
		const raw = await request.text();
		if (raw.trim() !== "") {
			try {
				json = JSON.parse(raw);
			} catch {
				return jsonError("Pedido inválido.", 422, "forUid");
			}
		}
		const input = parseHelpInput(json);
		if (!input.ok) return jsonError(input.error, input.status, input.field);

		const res = await helpExpense(await getDb(), id, eid, user.uid, input.forUid);
		switch (res.status) {
			case "no_group":
				return jsonError("Grupo não encontrado.", 404);
			case "no_expense":
				return jsonError("Despesa não encontrada.", 404);
			case "payer":
				return jsonError("Quem pagou a despesa não pode entrar na divisão dela.", 403);
			case "already":
				return jsonError(res.name ? `${res.name} já participa desta despesa.` : "Você já participa desta despesa.", 409);
			case "invalid":
				return jsonError(res.error, 422, res.field);
			case "conflict":
				return jsonError("Essa despesa acabou de ser alterada. Tente de novo.", 409);
			case "ok":
				return Response.json(res.expense);
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/expenses/[eid]/help POST");
	}
}
