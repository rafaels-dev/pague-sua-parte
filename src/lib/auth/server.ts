import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type AuthUser = { uid: string; email: string; name: string; picture?: string };

/** Lançado quando o token está ausente/inválido; as rotas devem mapear para HTTP 401. */
export class UnauthorizedError extends Error {}

const FIREBASE_JWKS_URL =
	"https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/** Chave(s) aceitas por jwtVerify (JWKS remoto ou chave local nos testes). */
export type KeySet = Parameters<typeof jwtVerify>[1];

let remoteKeySet: KeySet | undefined;
function defaultKeySet(): KeySet {
	// createRemoteJWKSet faz cache e respeita o cooldown; reutilizado entre requisições do isolate.
	remoteKeySet ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
	return remoteKeySet;
}

/**
 * Verifica um ID token do Firebase (RS256, issuer/audience do projeto, sub, exp/iat/auth_time).
 * Lança UnauthorizedError se qualquer verificação falhar.
 */
export async function verifyIdToken(
	token: string,
	opts: { projectId: string; keySet: KeySet; now?: Date },
): Promise<AuthUser> {
	let payload: JWTPayload;
	try {
		({ payload } = await jwtVerify(token, opts.keySet, {
			algorithms: ["RS256"],
			issuer: `https://securetoken.google.com/${opts.projectId}`,
			audience: opts.projectId,
			currentDate: opts.now,
			clockTolerance: 5,
		}));
	} catch {
		throw new UnauthorizedError("Token inválido ou expirado.");
	}

	const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
	const tolerance = 5;
	if (typeof payload.sub !== "string" || payload.sub.length === 0) {
		throw new UnauthorizedError("Token sem usuário.");
	}
	if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
		throw new UnauthorizedError("Token sem datas válidas.");
	}
	if (payload.iat > nowSec + tolerance) throw new UnauthorizedError("Token emitido no futuro.");
	const authTime = payload.auth_time;
	if (typeof authTime !== "number" || authTime > nowSec + tolerance) {
		throw new UnauthorizedError("Token com auth_time inválido.");
	}
	// O app só aceita login com Google: um token de outro provedor (e-mail e senha, anônimo) é recusado mesmo que alguém o ative no Firebase.
	const provider = (payload.firebase as { sign_in_provider?: unknown } | undefined)?.sign_in_provider;
	if (provider !== "google.com") throw new UnauthorizedError("Login não aceito.");

	const email = typeof payload.email === "string" ? payload.email : "";
	const name = typeof payload.name === "string" && payload.name ? payload.name : email || "Usuário";
	const picture = typeof payload.picture === "string" ? payload.picture : undefined;
	return { uid: payload.sub, email, name, ...(picture ? { picture } : {}) };
}

/**
 * Lê `Authorization: Bearer <Firebase ID token>`, verifica o JWT com `jose`
 * (JWKS do Firebase, issuer/audience = FIREBASE_PROJECT_ID) e retorna o usuário.
 */
export async function requireUser(request: Request): Promise<AuthUser> {
	const header = request.headers.get("authorization") ?? "";
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	if (!match) throw new UnauthorizedError("Faça login para continuar.");

	const projectId = process.env.FIREBASE_PROJECT_ID;
	if (!projectId) {
		// Erro de configuração do servidor, não do usuário: não mapear para 401.
		throw new Error("FIREBASE_PROJECT_ID não configurado no servidor.");
	}
	return verifyIdToken(match[1], { projectId, keySet: defaultKeySet() });
}
