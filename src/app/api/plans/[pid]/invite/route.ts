import { z } from "zod";
import { handleError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { PLAN_NOT_FOUND } from "@/lib/plans/http";
import { getOrCreatePlanInvite } from "@/lib/plans/repo";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ regenerate: z.boolean().optional() });

/** O link de convite do plano. Qualquer participante pega o atual; só quem criou gera um novo (o antigo deixa de valer). */
export async function POST(request: Request, { params }: { params: Promise<{ pid: string }> }) {
	try {
		const user = await requireUser(request);
		const { pid } = await params;
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
		const r = await getOrCreatePlanInvite(await getDb(), pid, user.uid, parsed.data.regenerate === true);
		if (r.status === "not_found") return jsonError(PLAN_NOT_FOUND, 404);
		if (r.status === "forbidden") return jsonError("Só quem criou o plano pode gerar um novo link.", 403);
		if (r.status === "closed") return jsonError("Este plano não recebe mais pessoas.", 409);
		return Response.json({ token: r.token, expiresAt: r.expiresAt.toISOString() });
	} catch (err) {
		return handleError(err, "api/plans/[pid]/invite POST");
	}
}
