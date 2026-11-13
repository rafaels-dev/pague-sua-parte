import { createHash, timingSafeEqual } from "node:crypto";

/**
 * O cron da Vercel chama com `Authorization: Bearer <CRON_SECRET>`. Só esse formato vale; sem `CRON_SECRET` configurado, nada vale.
 * Compara os hashes (mesmo tamanho) em tempo constante.
 */
export function isCronAuthorized(authorization: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
	if (!secret || secret.length < 16) return false;
	if (!authorization || !authorization.startsWith("Bearer ")) return false;
	const given = createHash("sha256").update(authorization.slice(7)).digest();
	const wanted = createHash("sha256").update(secret).digest();
	return timingSafeEqual(given, wanted);
}
