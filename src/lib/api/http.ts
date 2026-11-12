import { UnauthorizedError } from "@/lib/auth/server";

/** Códigos de erro que o cliente usa para decidir a tela (`code` na resposta). */
export type ErrorCode = "no_group" | "no_expense";

/**
 * Resposta de erro padrão: `{ error, field?, code? }` com mensagem em pt-BR.
 * `no_group`: grupo inexistente OU quem chama não é membro (mesma resposta para os dois, de propósito).
 * `no_expense`: só é devolvido depois de conferir que quem chama é membro.
 */
export function jsonError(message: string, status: number, field?: string, code?: ErrorCode) {
	return Response.json({ error: message, ...(field ? { field } : {}), ...(code ? { code } : {}) }, { status });
}

/**
 * Texto do erro para o log do servidor (nunca vai na resposta): nome e mensagem curta, sem endereços de conexão.
 * Sem isso o log só dizia "Error" e não dava para saber o que falhou em produção.
 */
export function describeError(err: unknown): string {
	if (!(err instanceof Error)) return "unknown";
	const message = err.message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<endereço>").slice(0, 300);
	return message ? `${err.name}: ${message}` : err.name;
}

/** Mapeia exceções para resposta HTTP sem vazar detalhes internos. */
export function handleError(err: unknown, label: string) {
	if (err instanceof UnauthorizedError) return jsonError("Sessão expirada. Entre novamente.", 401);
	console.error(`${label} error:`, describeError(err));
	return jsonError("Algo deu errado. Tente novamente em instantes.", 500);
}

/** Limite de corpo de requisição das funções da Vercel (4,5 MB): nenhum limite nosso pode passar disso. */
export const PLATFORM_MAX_BODY_BYTES = 4.5 * 1024 * 1024;
/** Folga para o corpo multipart além dos arquivos. */
export const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

/**
 * O corpo declarado passa do limite? Sem `Content-Length` válido (envio em pedaços) também recusa: o corpo inteiro
 * seria lido para a memória antes de qualquer conferência de tamanho.
 */
export function bodyTooLarge(request: Request, maxBytes: number): boolean {
	const raw = request.headers.get("content-length");
	const declared = raw === null ? Number.NaN : Number(raw);
	return !Number.isFinite(declared) || declared < 0 || declared > Math.min(maxBytes, PLATFORM_MAX_BODY_BYTES);
}
