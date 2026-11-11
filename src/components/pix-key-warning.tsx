"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Banner, Button } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";

/** Aviso (visual) de chave Pix ausente. */
export function PixKeyWarningView() {
	return (
		<Banner
			title="Você não configurou sua chave Pix."
			action={
				<Button href="/app/perfil" size="md" fullWidth className="md:w-auto">
					Configurar chave Pix
				</Button>
			}
		>
			Sem ela, as outras pessoas não conseguem pagar você.
		</Banner>
	);
}

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
	return <PixKeyWarningView />;
}
