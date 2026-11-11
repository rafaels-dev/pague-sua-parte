"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, TextField } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";

export function CreateGroupFormView({
	name,
	onNameChange,
	busy,
	error,
	onSubmit,
}: Readonly<{
	name: string;
	onNameChange: (value: string) => void;
	busy: boolean;
	error: string | null;
	onSubmit: (e: React.FormEvent) => void;
}>) {
	return (
		<div className="md:max-w-xl">
			<h1 className="sr-only">Criar grupo</h1>
			<Card className="p-5 md:p-8">
				<form onSubmit={onSubmit} className="space-y-6" noValidate>
					<TextField
						label="Nome do grupo"
						name="name"
						type="text"
						maxLength={60}
						autoComplete="off"
						placeholder="Despesas da vó"
						value={name}
						error={error}
						onChange={(e) => onNameChange(e.target.value)}
					/>
					<div className="flex flex-col gap-3">
						<Button type="submit" loading={busy} fullWidth>
							{busy ? "Criando..." : "Criar grupo"}
						</Button>
						<Button href="/app" variant="text" fullWidth size="md">
							Voltar
						</Button>
					</div>
				</form>
			</Card>
		</div>
	);
}

export function CreateGroupForm() {
	const router = useRouter();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (!name.trim()) {
			setError("Escreva um nome para o grupo.");
			return;
		}
		setBusy(true);
		try {
			const group = await apiFetch<{ id: string }>("/api/groups", {
				method: "POST",
				body: JSON.stringify({ name: name.trim() }),
			});
			router.push(`/app/grupos/${group.id}`);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Não foi possível criar o grupo. Tente de novo.");
			setBusy(false);
		}
	}

	return (
		<CreateGroupFormView
			name={name}
			onNameChange={(v) => {
				setName(v);
				setError(null);
			}}
			busy={busy}
			error={error}
			onSubmit={onSubmit}
		/>
	);
}
