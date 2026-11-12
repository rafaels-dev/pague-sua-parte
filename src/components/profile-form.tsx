"use client";

import { Avatar, Button, Card, Skeleton, TextField } from "@/components/ui";
import { PixKeyChoice } from "@/components/pix-key-choice";
import { PIX_KEY_LABELS, type AmbiguousKeyChoice } from "@/lib/pix/key";

export type ProfileFormViewProps = {
	email: string;
	picture: string | null;
	displayName: string;
	pixKey: string;
	/** Tipo detectado da chave Pix (rótulo), quando válida. */
	detectedType: keyof typeof PIX_KEY_LABELS | null;
	showInvalidHint: boolean;
	/** O número pode ser CPF ou celular: pede a escolha. */
	ambiguous?: boolean;
	keyChoice?: AmbiguousKeyChoice | null;
	onKeyChoice?: (v: AmbiguousKeyChoice) => void;
	pixError: string | null;
	formError: string | null;
	saving: boolean;
	onDisplayName: (v: string) => void;
	onPixKey: (v: string) => void;
	onSubmit: (e: React.FormEvent) => void;
};

/** Formulário do perfil (visual): nome, chave Pix, erros e botão de salvar. */
export function ProfileFormView(p: Readonly<ProfileFormViewProps>) {
	const pixSupport = p.detectedType ? (
		<span className="font-medium text-primary">Tipo da chave: {PIX_KEY_LABELS[p.detectedType]}</span>
	) : p.showInvalidHint ? (
		"Ainda não parece uma chave Pix válida."
	) : (
		"É para onde os outros vão pagar você. Confira se essa chave está ativa no seu banco e recebendo Pix."
	);

	return (
		<div className="grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
			<h1 className="sr-only">Meu perfil</h1>
			<Card tone="default" className="flex items-center gap-4 p-5 lg:flex-col lg:items-start lg:p-6">
				<Avatar name={p.displayName || p.email} src={p.picture} size="lg" />
				<div className="min-w-0">
					<p className="truncate text-title-large">{p.displayName}</p>
					<p className="break-all text-body-large text-on-surface-variant">{p.email}</p>
				</div>
			</Card>

			<Card className="p-5 md:p-8">
				<form onSubmit={p.onSubmit} className="space-y-6 md:max-w-xl" noValidate>
					<TextField
						label="Nome"
						name="name"
						type="text"
						autoComplete="name"
						maxLength={60}
						value={p.displayName}
						onChange={(e) => p.onDisplayName(e.target.value)}
					/>
					<TextField
						label="Chave Pix"
						name="pixKey"
						type="text"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						placeholder="CPF, e-mail, celular ou chave aleatória"
						value={p.pixKey}
						error={p.pixError}
						supportingText={pixSupport}
						onChange={(e) => p.onPixKey(e.target.value)}
					/>
					{p.ambiguous && p.onKeyChoice && <PixKeyChoice value={p.keyChoice ?? null} onChange={p.onKeyChoice} />}
					{p.formError && (
						<p role="alert" className="text-body-large text-error">
							{p.formError}
						</p>
					)}
					<Button type="submit" loading={p.saving} fullWidth className="md:w-auto md:min-w-48">
						{p.saving ? "Salvando..." : "Salvar"}
					</Button>
				</form>
			</Card>
		</div>
	);
}

export function ProfileSkeleton() {
	return (
		<div role="status" className="grid gap-6 lg:grid-cols-[18rem_1fr]">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-24 rounded-shape-lg lg:h-48" />
			<div className="space-y-6">
				<Skeleton className="h-14" />
				<Skeleton className="h-14" />
				<Skeleton className="h-14 rounded-full" />
			</div>
		</div>
	);
}
