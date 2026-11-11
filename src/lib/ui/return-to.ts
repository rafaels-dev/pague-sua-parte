/**
 * Caminho para voltar depois do login. Só aceita endereços do próprio app ("/app/...") para que
 * um link malicioso não leve a pessoa para outro site.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
	if (typeof raw !== "string" || raw.length > 500) return null;
	if (!raw.startsWith("/app/")) return null;
	if (raw.includes("\\") || raw.includes("//") || /[\u0000-\u001f\u007f]/.test(raw)) return null;
	if (raw.split(/[?#]/)[0].split("/").some((seg) => seg === ".." || seg === ".")) return null;
	return raw;
}

/** Endereço da tela de entrada que lembra para onde voltar; "/" se o caminho não for aceito. */
export function loginUrlFor(path: string): string {
	const safe = safeReturnPath(path);
	return safe ? `/?voltar=${encodeURIComponent(safe)}` : "/";
}

/** Tela inicial do app (aceita como destino de volta, além dos caminhos "/app/..."). */
const APP_HOME = "/app";

/** Endereço do perfil que lembra para onde voltar depois de salvar. */
export function profileUrlFor(path: string): string {
	const safe = path === APP_HOME ? APP_HOME : safeReturnPath(path);
	return safe ? `/app/perfil?voltar=${encodeURIComponent(safe)}` : "/app/perfil";
}

/** Para onde voltar depois de salvar o perfil; null quando a pessoa abriu o perfil direto. */
export function profileReturnPath(search: string): string | null {
	const raw = new URLSearchParams(search).get("voltar");
	return raw === APP_HOME ? APP_HOME : safeReturnPath(raw);
}
