import { oneLine } from "./email-content";
import { renderNoticeEmail } from "./email-template";
import type { Notice } from "./types";

/** Endereço público do app (links dos e-mails). `APP_URL` no ambiente; sem ela, produção e desenvolvimento têm um padrão. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
	const raw = env.APP_URL?.trim() || (env.NODE_ENV === "production" ? "https://paguesuaparte.com.br" : "http://localhost:3000");
	return raw.replace(/\/+$/, "");
}

export class EmailError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		/** Segundos até poder tentar de novo (429), vindos de `X-RateLimit-Reset`/`Retry-After`. */
		public readonly retryAfter?: number,
	) {
		super(message);
		this.name = "EmailError";
	}
}

export type RenderedEmail = Awaited<ReturnType<typeof renderNoticeEmail>>;

/** Renderiza uma vez (quem tenta de novo depois de um 429 passa o resultado a `sendEmail`). */
export const renderEmail = (notice: Notice, env: NodeJS.ProcessEnv = process.env): Promise<RenderedEmail> => renderNoticeEmail(notice, appBaseUrl(env));

/** Nome de domínio válido (letras, números e hífens em rótulos separados por ponto): vai para o caminho da URL. */
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export const isValidMailDomain = (d: string | undefined): d is string => typeof d === "string" && DOMAIN_RE.test(d);

/** Só dois endereços da API do Mailgun; nunca um host vindo de variável. `MAILGUN_REGION=eu` escolhe a Europa, qualquer outro valor, os EUA. */
export function mailgunBase(env: NodeJS.ProcessEnv = process.env): string {
	return env.MAILGUN_REGION?.trim().toLowerCase() === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
}

function rateLimitWait(res: Response): number | undefined {
	const reset = Number(res.headers.get("x-ratelimit-reset")); // Mailgun: milissegundos Unix
	if (Number.isFinite(reset) && reset > 1e12) {
		const s = Math.ceil((reset - Date.now()) / 1000);
		if (s > 0) return s;
	}
	const retry = Number(res.headers.get("retry-after"));
	return Number.isFinite(retry) && retry > 0 ? retry : undefined;
}

/**
 * Envia pela API HTTP do Mailgun (fetch direto, sem SDK). Sem chave, domínio válido e remetente, não faz nada. Devolve se enviou.
 * Corpo em formulário (`URLSearchParams` cuida de acentos, emoji, `&`, `=`); chave só no cabeçalho `Authorization`.
 * Rastreio de abertura e de clique desligado no próprio envio.
 */
export async function sendEmail(to: string, notice: Notice, env: NodeJS.ProcessEnv = process.env, rendered?: RenderedEmail): Promise<boolean> {
	if (!emailConfigured(env)) return false;
	const key = env.MAILGUN_SENDING_KEY as string;
	const domain = env.MAILGUN_DOMAIN as string;
	const { subject, html, text } = rendered ?? (await renderEmail(notice, env));
	const form = new URLSearchParams({
		from: oneLine(env.EMAIL_FROM as string),
		to: oneLine(to),
		subject: oneLine(subject),
		html,
		text,
		"o:tracking": "no",
		"o:tracking-opens": "no",
		"o:tracking-clicks": "no",
	});
	const res = await fetch(`${mailgunBase(env)}/v3/${domain}/messages`, {
		method: "POST",
		headers: { Authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
		body: form.toString(),
		signal: AbortSignal.timeout(8000),
	});
	if (!res.ok) throw new EmailError(`Mailgun respondeu ${res.status}`, res.status, res.status === 429 ? rateLimitWait(res) : undefined);
	return true;
}

export const emailConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.MAILGUN_SENDING_KEY && isValidMailDomain(env.MAILGUN_DOMAIN) && env.EMAIL_FROM);
