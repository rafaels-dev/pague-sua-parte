import { isCronAuthorized } from "@/lib/api/cron-auth";
import { describeError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { runReminders } from "@/lib/reminders/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lembretes de vencimento das despesas fixas. Chamado uma vez por dia pelo Vercel Cron (`vercel.json`), com
 * `Authorization: Bearer <CRON_SECRET>`. Qualquer outro pedido recebe 401 sem detalhe. A resposta só traz contagens.
 */
export async function GET(request: Request) {
	if (!isCronAuthorized(request.headers.get("authorization"))) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
	try {
		const r = await runReminders(await getDb());
		return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
	} catch (err) {
		console.error("api/cron/reminders error:", describeError(err));
		return Response.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
	}
}

// Só GET executa a lógica. O Next implementaria HEAD e OPTIONS sozinho (HEAD roda o GET); por isso ficam explícitos e sem efeito.
const NOT_ALLOWED = () => new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
export const POST = NOT_ALLOWED;
export const PUT = NOT_ALLOWED;
export const PATCH = NOT_ALLOWED;
export const DELETE = NOT_ALLOWED;
export const HEAD = NOT_ALLOWED;
export const OPTIONS = NOT_ALLOWED;
