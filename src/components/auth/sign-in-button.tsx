"use client";

import { useState } from "react";
import { Banner, CircularProgress } from "@/components/ui";
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

/** Logo "G" do Google (cores oficiais da marca). */
function GoogleG() {
	return (
		<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true" className="shrink-0">
			<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
			<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
			<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
			<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
		</svg>
	);
}

/** Botão no estilo do "Entrar com o Google": superfície branca (escura no tema escuro), logo "G" e contorno fino. */
export function GoogleButtonView({ busy, disabled, onClick }: Readonly<{ busy?: boolean; disabled?: boolean; onClick?: () => void }>) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy || disabled}
			aria-busy={busy || undefined}
			className="state-layer flex h-14 w-full items-center justify-center gap-3 rounded-full border border-google-border bg-google-bg px-6 text-label-large text-google-fg transition-colors duration-150 disabled:opacity-60"
		>
			{busy ? <CircularProgress size={22} label="" /> : <GoogleG />}
			<span>{busy ? "Entrando..." : "Entrar com Google"}</span>
		</button>
	);
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
			<GoogleButtonView busy={busy} disabled={!configured} onClick={() => void handleClick()} />
			{!configured && (
				<Banner tone="error" icon="error" role="alert">
					O login ainda não foi configurado. Avise quem administra o app.
				</Banner>
			)}
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
		</div>
	);
}
