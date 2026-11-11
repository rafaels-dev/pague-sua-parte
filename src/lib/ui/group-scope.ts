/**
 * "Só deste grupo" nas telas Pagar tudo e Quem me deve: o endereço leva `?grupo=<id>`.
 * Lê o id (só 24 letras/números hexadecimais; qualquer outra coisa vale como "sem grupo").
 */
const GROUP_ID_RE = /^[0-9a-f]{24}$/i;

export function groupParam(search: string | null | undefined): string | null {
	const raw = new URLSearchParams(search ?? "").get("grupo");
	return raw && GROUP_ID_RE.test(raw) ? raw : null;
}

/** Endereço da tela de pagar tudo, de um grupo ou de todos. */
export function payAllUrl(groupId?: string | null): string {
	return groupId ? `/app/pagar?grupo=${encodeURIComponent(groupId)}` : "/app/pagar";
}

/** Endereço de "Quem me deve", de um grupo ou de todos. */
export function receivablesUrl(groupId?: string | null): string {
	return groupId ? `/app/receber?grupo=${encodeURIComponent(groupId)}` : "/app/receber";
}

/** Endereço da API com o filtro por grupo, quando há. */
export function scopedApiUrl(path: string, groupId: string | null): string {
	return groupId ? `${path}?groupId=${encodeURIComponent(groupId)}` : path;
}

/** O grupo que a resposta diz ter usado como filtro (`group` em payables/receivables), ou null. */
export function normalizeScopeGroup(raw: unknown): { id: string; name: string } | null {
	const g = raw && typeof raw === "object" ? (raw as { group?: unknown }).group : null;
	if (!g || typeof g !== "object") return null;
	const { id, name } = g as { id?: unknown; name?: unknown };
	return typeof id === "string" && id ? { id, name: typeof name === "string" && name.trim() ? name.trim() : "este grupo" } : null;
}
