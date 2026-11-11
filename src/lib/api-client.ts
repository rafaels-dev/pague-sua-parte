"use client";

import { getIdToken } from "@/lib/auth/client";

export class ApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly field?: string,
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
	if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

	let res: Response;
	try {
		res = await fetch(path, { ...init, headers });
	} catch {
		throw new ApiError("Sem conexão. Verifique sua internet e tente de novo.", 0);
	}
	const data: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const d = (data ?? {}) as { error?: string; field?: string };
		throw new ApiError(d.error ?? "Algo deu errado. Tente novamente.", res.status, d.field);
	}
	return data as T;
}
