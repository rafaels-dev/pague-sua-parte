"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { apiFetch } from "@/lib/api-client";

/** Aviso exibido enquanto a pessoa não tiver chave Pix cadastrada no perfil. */
export function PixKeyWarning() {
	const { user } = useAuth();
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ pixKey: unknown | null }>("/api/me")
			.then((profile) => {
				if (!cancelled) setMissing(!profile.pixKey);
			})
			// Se o perfil não carregar, não mostramos o aviso: ele só aparece quando temos certeza.
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [user]);

	if (!missing) return null;

	return (
		<section
			role="status"
			className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100"
		>
			<p className="text-lg font-semibold">Você não configurou sua chave Pix.</p>
			<p className="mt-1 text-base">Sem ela, as outras pessoas não conseguem pagar você.</p>
			<Link
				href="/app/perfil"
				className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-amber-900 px-5 text-lg font-semibold text-amber-50 active:opacity-80 md:inline-flex dark:bg-amber-300 dark:text-amber-950"
			>
				Configurar chave Pix
			</Link>
		</section>
	);
}
