"use client";

import type { AuthUser } from "./server";

/** Dados do usuário no cliente (subconjunto seguro de AuthUser). */
export type ClientUser = Pick<AuthUser, "uid" | "email" | "name" | "picture">;

/** Abre o popup/redirect de login Google do Firebase. TODO(auth agent). */
export async function signInWithGoogle(): Promise<void> {
	throw new Error("not implemented");
}

export async function signOut(): Promise<void> {
	throw new Error("not implemented");
}

/** ID token atual (renovado se preciso) ou null se deslogado. */
export async function getIdToken(): Promise<string | null> {
	throw new Error("not implemented");
}

/** Observa mudanças de login; retorna a função de cancelamento. */
export function onUserChanged(cb: (user: ClientUser | null) => void): () => void {
	void cb;
	throw new Error("not implemented");
}
