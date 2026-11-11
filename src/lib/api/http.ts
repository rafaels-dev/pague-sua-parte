import { UnauthorizedError } from "@/lib/auth/server";

/** Resposta de erro padrão: `{ error, field? }` com mensagem em pt-BR. */
export function jsonError(message: string, status: number, field?: string) {
	return Response.json({ error: message, ...(field ? { field } : {}) }, { status });
}

/** Mapeia exceções para resposta HTTP sem vazar detalhes internos. */
export function handleError(err: unknown, label: string) {
	if (err instanceof UnauthorizedError) return jsonError("Sessão expirada. Entre novamente.", 401);
	console.error(`${label} error:`, err instanceof Error ? err.name : "unknown");
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
