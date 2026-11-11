import { z } from "zod";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { getOrCreateInvite } from "@/lib/groups/repo";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ regenerate: z.boolean().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const user = await requireUser(request);
		const { id } = await params;

		let json: unknown = {};
		const text = await request.text();
		if (text.trim() !== "") {
			try {
				json = JSON.parse(text);
			} catch {
				return jsonError("Pedido inválido.", 400);
			}
		}
		const parsed = bodySchema.safeParse(json);
		if (!parsed.success) return jsonError("Pedido inválido.", 400);

		const result = await getOrCreateInvite(await getDb(), id, user.uid, parsed.data.regenerate === true);
		if (result.status === "not_found") return jsonError("Grupo não encontrado.", 404);
		if (result.status === "forbidden") {
			return jsonError("Só quem administra o grupo pode gerar um novo link.", 403);
		}
		return Response.json({ token: result.token, expiresAt: result.expiresAt.toISOString() });
	} catch (err) {
		return handleError(err, "api/groups/[id]/invite");
	}
}
