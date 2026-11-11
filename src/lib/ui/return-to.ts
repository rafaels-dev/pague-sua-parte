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
