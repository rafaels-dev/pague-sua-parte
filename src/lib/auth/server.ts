export type AuthUser = { uid: string; email: string; name: string; picture?: string };

/** Lançado quando o token está ausente/inválido; as rotas devem mapear para HTTP 401. */
export class UnauthorizedError extends Error {}

/**
 * Lê `Authorization: Bearer <Firebase ID token>`, verifica o JWT com `jose`
 * (JWKS do Firebase, issuer/audience = FIREBASE_PROJECT_ID) e retorna o usuário.
 * Deve lançar UnauthorizedError quando inválido.
 * TODO(auth agent): implementar.
 */
export async function requireUser(request: Request): Promise<AuthUser> {
	void request;
	throw new Error("not implemented");
}
