"use client";

import { useState } from "react";
import { FirebaseConfigError, signInWithGoogle } from "@/lib/auth/client";
import { useAuth } from "./auth-provider";

function friendlyError(err: unknown): string | null {
	if (err instanceof FirebaseConfigError) return err.message;
	const code = (err as { code?: string } | null)?.code ?? "";
	switch (code) {
		case "auth/popup-closed-by-user":
		case "auth/cancelled-popup-request":
		case "auth/user-cancelled":
			return null; // usuário desistiu: sem alarde
		case "auth/popup-blocked":
			return "O navegador bloqueou a janela de login. Permita pop-ups para este site e toque no botão de novo.";
		case "auth/network-request-failed":
			return "Sem conexão com a internet. Confira o sinal e tente de novo.";
		case "auth/unauthorized-domain":
			return "Este endereço ainda não foi liberado para login. Avise quem administra o app.";
		case "auth/too-many-requests":
			return "Muitas tentativas. Espere alguns minutos e tente de novo.";
		default:
			return "Não foi possível entrar agora. Tente de novo em instantes.";
	}
}

export function SignInButton({ onSignedIn }: Readonly<{ onSignedIn?: () => void }>) {
	const { configured } = useAuth();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleClick() {
		setError(null);
		setBusy(true);
		try {
			await signInWithGoogle();
			onSignedIn?.();
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="space-y-3">
			<button
				type="button"
				onClick={handleClick}
				disabled={busy || !configured}
				className="min-h-14 w-full rounded-2xl bg-primary px-6 text-xl font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60"
			>
				{busy ? "Entrando..." : "Entrar com Google"}
			</button>
			{!configured && (
				<p role="alert" className="text-center text-base">
					O login ainda não foi configurado. Avise quem administra o app.
				</p>
			)}
			{error && (
				<p role="alert" className="text-center text-base">
					{error}
				</p>
			)}
		</div>
	);
}
