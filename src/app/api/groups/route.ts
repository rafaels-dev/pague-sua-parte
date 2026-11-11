import { z } from "zod";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { MAX_NAME_LENGTH } from "@/lib/groups/helpers";
import { createGroup, listGroups } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
	name: z
		.string("Dê um nome ao grupo.")
		.trim()
		.min(1, "Dê um nome ao grupo.")
		.max(MAX_NAME_LENGTH, `O nome pode ter no máximo ${MAX_NAME_LENGTH} letras.`),
});

export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		const groups = await listGroups(await getDb(), user.uid);
		return Response.json({ groups });
	} catch (err) {
		return handleError(err, "api/groups");
	}
}

export async function POST(request: Request) {
	try {
		const user = await requireUser(request);
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonError("Pedido inválido.", 400);
		}
		const parsed = bodySchema.safeParse(json);
		if (!parsed.success) {
			return jsonError(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, "name");
		}
		const group = await createGroup(await getDb(), user.uid, parsed.data.name);
		return Response.json(group, { status: 201 });
	} catch (err) {
		return handleError(err, "api/groups");
	}
}
