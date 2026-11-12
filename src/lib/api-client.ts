"use client";

import { getIdToken } from "@/lib/auth/client";

export class ApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly field?: string,
		/** "no_group" (grupo inexistente ou não é membro) ou "no_expense" (despesa inexistente; só para membros). */
		public readonly code?: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/** fetch com `Authorization: Bearer <token>`; lança ApiError com a mensagem do servidor. */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
	const token = await getIdToken();
	const headers = new Headers(init.headers);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	// FormData: o navegador define o Content-Type (com o "boundary"); não pode ser fixado à mão.
	if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

	let res: Response;
	try {
		res = await fetch(path, { ...init, headers });
	} catch {
		throw new ApiError("Sem conexão. Verifique sua internet e tente de novo.", 0);
	}
	const data: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const d = (data ?? {}) as { error?: string; field?: string; code?: string };
		throw new ApiError(d.error ?? "Algo deu errado. Tente novamente.", res.status, d.field, d.code);
	}
	return data as T;
}

/** GET autenticado de um arquivo (ex.: anexo); devolve o Blob. Para exibir, use URL.createObjectURL e revogue depois. */
export async function apiFetchBlob(path: string): Promise<Blob> {
	const token = await getIdToken();
	const headers = new Headers();
	if (token) headers.set("Authorization", `Bearer ${token}`);

	let res: Response;
	try {
		res = await fetch(path, { headers });
	} catch {
		throw new ApiError("Sem conexão. Verifique sua internet e tente de novo.", 0);
	}
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as { error?: string; field?: string } | null;
		throw new ApiError(data?.error ?? "Não foi possível abrir o arquivo.", res.status, data?.field);
	}
	return res.blob();
}

/** 404 de grupo inexistente ou de quem não é membro (a API não distingue os dois, de propósito). */
export function isNotMemberError(e: unknown): boolean {
	return e instanceof ApiError && e.status === 404 && e.code !== "no_expense";
}

/** 404 de despesa inexistente; a API só diz isso depois de conferir que a pessoa é membro. */
export function isMissingExpenseError(e: unknown): boolean {
	return e instanceof ApiError && e.status === 404 && e.code === "no_expense";
}
