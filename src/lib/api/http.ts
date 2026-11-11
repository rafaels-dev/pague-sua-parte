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
