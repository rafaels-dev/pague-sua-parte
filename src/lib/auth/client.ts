"use client";

import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { AuthUser } from "./server";

/** Dados do usuário no cliente (subconjunto seguro de AuthUser). */
export type ClientUser = Pick<AuthUser, "uid" | "email" | "name" | "picture">;

/** Falta configuração do Firebase (variáveis NEXT_PUBLIC_FIREBASE_*). */
export class FirebaseConfigError extends Error {
	constructor() {
		super("O login ainda não foi configurado. Avise quem administra o app.");
	}
}

// Variáveis NEXT_PUBLIC_* precisam ser referenciadas literalmente para o bundler inlinar.
function readConfig() {
	const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
	const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
	const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
	const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
	if (!apiKey || !authDomain || !projectId || !appId) return null;
	return { apiKey, authDomain, projectId, appId };
}

/** true se as variáveis do Firebase estão presentes. */
export function isAuthConfigured(): boolean {
	return readConfig() !== null;
}

let authPromise: Promise<Auth> | undefined;

/** Inicializa o Firebase sob demanda (nunca durante SSR/build). */
function getFirebaseAuth(): Promise<Auth> {
	authPromise ??= (async () => {
		if (typeof window === "undefined") throw new Error("Auth só funciona no navegador.");
		const config = readConfig();
		if (!config) throw new FirebaseConfigError();
		const [{ getApp, getApps, initializeApp }, { getAuth }] = await Promise.all([
			import("firebase/app"),
			import("firebase/auth"),
		]);
		const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
		return getAuth(app); // persistência local (padrão) no navegador
	})();
	authPromise.catch(() => {
		authPromise = undefined;
	});
	return authPromise;
}

/** Abre o popup de login Google do Firebase. */
export async function signInWithGoogle(): Promise<void> {
	const auth = await getFirebaseAuth();
	const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: "select_account" });
	await signInWithPopup(auth, provider);
}

export async function signOut(): Promise<void> {
	const auth = await getFirebaseAuth();
	const { signOut: fbSignOut } = await import("firebase/auth");
	await fbSignOut(auth);
}

/** ID token atual (renovado se preciso) ou null se deslogado. */
export async function getIdToken(): Promise<string | null> {
	if (!isAuthConfigured() || typeof window === "undefined") return null;
	const auth = await getFirebaseAuth();
	await auth.authStateReady();
	return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

/** Observa mudanças de login; retorna a função de cancelamento. */
export function onUserChanged(cb: (user: ClientUser | null) => void): () => void {
	let cancelled = false;
	let unsubscribe: (() => void) | undefined;
	void (async () => {
		try {
			const auth = await getFirebaseAuth();
			const { onAuthStateChanged } = await import("firebase/auth");
			if (cancelled) return;
			unsubscribe = onAuthStateChanged(auth, (u) => {
				if (!u) return cb(null);
				const email = u.email ?? "";
				cb({
					uid: u.uid,
					email,
					name: u.displayName || email || "Usuário",
					picture: u.photoURL ?? undefined,
				});
			});
		} catch {
			if (!cancelled) cb(null);
		}
	})();
	return () => {
		cancelled = true;
		unsubscribe?.();
	};
}
