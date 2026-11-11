"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { clearFlash, peekFlash } from "@/components/expenses/types";
import { Banner, Button, Snackbar } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { profileUrlFor } from "@/lib/ui/return-to";

/** Aviso (visual) de chave Pix ausente. */
export function PixKeyWarningView() {
	return (
		<Banner
			title="Você não configurou sua chave Pix."
			action={
				<Button href={profileUrlFor("/app")} size="md" fullWidth className="md:w-auto">
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
	// Recado de quem acabou de salvar a chave no perfil e voltou para cá.
	const [snack, setSnack] = useState<string | null>(() => peekFlash());

	useEffect(() => {
		clearFlash();
	}, []);

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

	return (
		<>
			{missing && <PixKeyWarningView />}
			<Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} aboveNav />
		</>
	);
}
