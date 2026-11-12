import type { Notice } from "./types";

export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Endereço público do app (links dos e-mails). `APP_URL` no ambiente; sem ela, produção e desenvolvimento têm um padrão. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
	const raw = env.APP_URL?.trim() || (env.NODE_ENV === "production" ? "https://paguesuaparte.com.br" : "http://localhost:3000");
	return raw.replace(/\/+$/, "");
}

const FOOTER = "Para parar de receber, abra Perfil > Avisos.";

export function buildEmail(notice: Pick<Notice, "title" | "body" | "url">, baseUrl: string): { subject: string; html: string; text: string } {
	const link = `${baseUrl}${notice.url.startsWith("/") ? notice.url : `/${notice.url}`}`;
	const title = escapeHtml(notice.title);
	const body = escapeHtml(notice.body);
	const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f5fbf8;font-family:Arial,Helvetica,sans-serif;color:#161d1b">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${body}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#006b5b;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 24px;border-radius:999px">Abrir o PagueSuaParte</a></p>
<p style="margin:0;font-size:13px;color:#5a6360">${escapeHtml(FOOTER)}</p>
</div></body></html>`;
	const text = `${notice.title}\n\n${notice.body}\n\nAbrir: ${link}\n\n${FOOTER}\n`;
	return { subject: notice.title, html, text };
}

export class EmailError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		/** Segundos pedidos pelo serviço em `Retry-After` (429). */
		public readonly retryAfter?: number,
	) {
		super(message);
		this.name = "EmailError";
	}
}

/** Envia por Resend (fetch direto). Sem `RESEND_API_KEY`/`EMAIL_FROM`, não faz nada. Devolve se enviou. */
export async function sendEmail(to: string, notice: Notice, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
	const key = env.RESEND_API_KEY;
	const from = env.EMAIL_FROM;
	if (!key || !from) return false;
	const { subject, html, text } = buildEmail(notice, appBaseUrl(env));
	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({ from, to: [to], subject, html, text }),
		signal: AbortSignal.timeout(8000),
	});
	if (!res.ok) {
		const wait = Number(res.headers.get("retry-after"));
		throw new EmailError(`Resend respondeu ${res.status}`, res.status, Number.isFinite(wait) && wait > 0 ? wait : undefined);
	}
	return true;
}

export const emailConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
