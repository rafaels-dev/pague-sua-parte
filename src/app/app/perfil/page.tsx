"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ProfileFormView, ProfileSkeleton } from "@/components/profile-form";
import { Button, EmptyState, Snackbar } from "@/components/ui";
import { onUserChanged } from "@/lib/auth/client";
import { apiFetch, ApiError } from "@/lib/api-client";
import { setFlash } from "@/components/expenses/types";
import { detectPixKeyType, PIX_KEY_LABELS } from "@/lib/pix/key";
import { profileReturnPath } from "@/lib/ui/return-to";

type Profile = {
	uid: string;
	email: string;
	name: string;
	displayName: string | null;
	pixKey: { type: keyof typeof PIX_KEY_LABELS; key: string } | null;
};

export default function PerfilPage() {
	const router = useRouter();
	const { user } = useAuth();
	const [profile, setProfile] = useState<Profile | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [displayName, setDisplayName] = useState("");
	const [pixKey, setPixKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [pixError, setPixError] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const unsubscribe = onUserChanged((user) => {
			if (!user) return;
			setLoadError(null);
			apiFetch<Profile>("/api/me")
				.then((p) => {
					if (cancelled) return;
					setProfile(p);
					setDisplayName(p.displayName ?? p.name);
					setPixKey(p.pixKey?.key ?? "");
				})
				.catch((e) => {
					if (!cancelled) setLoadError(e instanceof ApiError ? e.message : "Não foi possível carregar seu perfil.");
				});
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [reloadKey]);

	const detected = pixKey.trim() ? detectPixKeyType(pixKey) : null;
	const showInvalidHint = pixKey.trim().length > 0 && !detected;

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaved(false);
		setPixError(null);
		setFormError(null);
		if (pixKey.trim() && !detectPixKeyType(pixKey)) {
			setPixError("Chave Pix inválida. Confira o número ou e-mail digitado.");
			return;
		}
		setSaving(true);
		try {
			const p = await apiFetch<Profile>("/api/me", {
				method: "PUT",
				body: JSON.stringify({ displayName, pixKey }),
			});
			setProfile(p);
			setDisplayName(p.displayName ?? p.name);
			setPixKey(p.pixKey?.key ?? "");
			// Quem veio de um aviso ("Configurar chave Pix") volta sozinho para onde estava, já com a chave salva.
			const back = p.pixKey ? profileReturnPath(window.location.search) : null;
			if (back) {
				if (back === "/app") setFlash("Chave Pix salva!");
				router.replace(back);
				return;
			}
			setSaved(true);
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : "Não foi possível salvar. Tente de novo.";
			if (err instanceof ApiError && err.field === "pixKey") setPixError(msg);
			else setFormError(msg);
		} finally {
			setSaving(false);
		}
	}

	if (loadError) {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title="Meu perfil"
				action={
					<Button
						icon="refresh"
						onClick={() => {
							setLoadError(null);
							setReloadKey((k) => k + 1);
						}}
					>
						Tentar de novo
					</Button>
				}
			>
				{loadError}
			</EmptyState>
		);
	}

	if (!profile) return <ProfileSkeleton />;

	return (
		<>
			<ProfileFormView
				email={profile.email}
				picture={user?.picture ?? null}
				displayName={displayName}
				pixKey={pixKey}
				detectedType={detected}
				showInvalidHint={showInvalidHint}
				pixError={pixError}
				formError={formError}
				saving={saving}
				onDisplayName={(v) => {
					setDisplayName(v);
					setSaved(false);
				}}
				onPixKey={(v) => {
					setPixKey(v);
					setSaved(false);
					setPixError(null);
				}}
				onSubmit={onSubmit}
			/>
			<Snackbar open={saved} message="Salvo!" onClose={() => setSaved(false)} aboveNav />
		</>
	);
}
