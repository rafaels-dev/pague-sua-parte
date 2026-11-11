import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { createRecurrence, listRecurrences } from "@/lib/recurrences/repo";
import { parseRecurrenceInput } from "@/lib/recurrences/validation";

export const dynamic = "force-dynamic";

const NOT_FOUND = "Grupo não encontrado.";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id } = await params;
		const recurrences = await listRecurrences(await getDb(), id, user.uid);
		if (!recurrences) return jsonError(NOT_FOUND, 404);
		return Response.json({ recurrences });
	} catch (err) {
		return handleError(err, "api/groups/[id]/recurrences GET");
	}
}

export async function POST(request: Request, { params }: Ctx) {
	try {
		const user = await requireUser(request);
		const { id } = await params;
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Dados inválidos.", 422, "description");
		}
		const input = parseRecurrenceInput(json);
		if (!input.ok) return jsonError(input.error, input.status, input.field);

		const result = await createRecurrence(await getDb(), { groupId: id, uid: user.uid, input: input.value });
		switch (result.status) {
			case "no_group":
				return jsonError(NOT_FOUND, 404);
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
				return Response.json({ ...result.recurrence, firstExpenseId: result.firstExpenseId }, { status: 201 });
		}
	} catch (err) {
		return handleError(err, "api/groups/[id]/recurrences POST");
	}
}
