"use client";

import { useEffect, useState } from "react";
import { onUserChanged } from "@/lib/auth/client";
import { apiFetch, ApiError } from "@/lib/api-client";
import { detectPixKeyType, PIX_KEY_LABELS } from "@/lib/pix/key";

type Profile = {
	uid: string;
	email: string;
	name: string;
	displayName: string | null;
	pixKey: { type: keyof typeof PIX_KEY_LABELS; key: string } | null;
};

const inputClass =
	"min-h-14 w-full rounded-xl border border-border bg-card px-4 text-lg outline-none focus:border-primary focus:ring-2 focus:ring-primary/40";

export default function PerfilPage() {
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
			<div className="space-y-5">
				<h1 className="text-3xl font-bold">Meu perfil</h1>
				<p role="alert" className="text-lg text-red-600">
					{loadError}
				</p>
				<button
					type="button"
					onClick={() => {
						setLoadError(null);
						setReloadKey((k) => k + 1);
					}}
					className="min-h-14 w-full rounded-2xl bg-primary px-6 text-xl font-semibold text-primary-foreground active:opacity-80"
				>
					Tentar de novo
				</button>
			</div>
		);
	}

	if (!profile) {
		return (
			<div className="space-y-5">
				<h1 className="text-3xl font-bold">Meu perfil</h1>
				<p className="text-lg text-muted" role="status">
					Carregando...
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-5">
			<h1 className="text-3xl font-bold">Meu perfil</h1>
			<p className="text-base text-muted">{profile.email}</p>

			<form onSubmit={onSubmit} className="space-y-5" noValidate>
				<label className="block space-y-2">
					<span className="text-base font-medium">Nome</span>
					<input
						name="name"
						type="text"
						autoComplete="name"
						maxLength={60}
						value={displayName}
						onChange={(e) => {
							setDisplayName(e.target.value);
							setSaved(false);
						}}
						className={inputClass}
					/>
				</label>

				<label className="block space-y-2">
					<span className="text-base font-medium">Chave Pix</span>
					<input
						name="pixKey"
						type="text"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						placeholder="CPF, e-mail, celular ou chave aleatória"
						value={pixKey}
						aria-invalid={!!pixError || showInvalidHint}
						onChange={(e) => {
							setPixKey(e.target.value);
							setSaved(false);
							setPixError(null);
						}}
						className={inputClass}
					/>
					{pixError ? (
						<span role="alert" className="block text-base text-red-600">
							{pixError}
						</span>
					) : detected ? (
						<span className="block text-base font-medium text-primary">Tipo da chave: {PIX_KEY_LABELS[detected]}</span>
					) : (
						<span className="block text-sm text-muted">
							{showInvalidHint ? "Ainda não parece uma chave Pix válida." : "É para onde os outros vão pagar você."}
						</span>
					)}
				</label>

				{formError && (
					<p role="alert" className="text-base text-red-600">
						{formError}
					</p>
				)}

				<button
					type="submit"
					disabled={saving}
					className="min-h-14 w-full rounded-2xl bg-primary px-6 text-xl font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60"
				>
					{saving ? "Salvando..." : "Salvar"}
				</button>
				{saved && (
					<p role="status" className="text-center text-lg font-semibold text-primary">
						Salvo!
					</p>
				)}
			</form>
		</div>
	);
}
