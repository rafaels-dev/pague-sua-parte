"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { SignInButton } from "@/components/auth/sign-in-button";
import { Wordmark } from "@/components/brand";
import { Banner, Button, CircularProgress, Icon } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { peopleLabel } from "@/lib/ui/invite";

type Invite = { groupId: string; groupName: string; memberCount: number; alreadyMember: boolean };

export function InviteShell({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10 md:max-w-lg">
			<Wordmark />
			<div className="flex flex-col gap-5 rounded-shape-lg bg-surface-container-low p-6 md:p-8">{children}</div>
		</main>
	);
}

function GroupBadge() {
	return (
		<span className="flex size-16 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
			<Icon name="group" size={32} />
		</span>
	);
}

/** Convite pronto para aceitar (visual). */
export function InviteReady({
	groupName,
	memberCount,
	accepting,
	acceptError,
	onAccept,
}: Readonly<{ groupName: string; memberCount: number; accepting: boolean; acceptError: string | null; onAccept: () => void }>) {
	return (
		<>
			<GroupBadge />
			<div className="space-y-1">
				<p className="text-body-large text-on-surface-variant">Você foi convidado para o grupo</p>
				<h1 className="break-words text-headline-medium font-bold">{groupName}</h1>
				<p className="text-body-large text-on-surface-variant">{peopleLabel(memberCount)} no grupo</p>
			</div>
			{acceptError && (
				<Banner tone="error" icon="error" role="alert">
					{acceptError}
				</Banner>
			)}
			<div className="flex flex-col gap-2">
				<Button onClick={onAccept} loading={accepting} fullWidth>
					{accepting ? "Entrando..." : "Entrar no grupo"}
				</Button>
				<Button href="/app" variant="text" size="md" fullWidth>
					Agora não
				</Button>
			</div>
		</>
	);
}

export function InviteAccept({ token }: Readonly<{ token: string }>) {
	const router = useRouter();
	const { user, loading } = useAuth();
	const [invite, setInvite] = useState<Invite | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [accepting, setAccepting] = useState(false);
	const [acceptError, setAcceptError] = useState<string | null>(null);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<Invite>(`/api/invites/${encodeURIComponent(token)}`)
			.then((i) => {
				if (!cancelled) setInvite(i);
			})
			.catch((e) => {
				if (!cancelled) setError(e instanceof ApiError ? e.message : "Não foi possível abrir o convite.");
			});
		return () => {
			cancelled = true;
		};
	}, [user, token, reloadKey]);

	async function accept() {
		setAccepting(true);
		setAcceptError(null);
		try {
			const res = await apiFetch<{ groupId: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, {
				method: "POST",
				body: JSON.stringify({}),
			});
			router.push(`/app/grupos/${res.groupId}`);
		} catch (e) {
			setAcceptError(e instanceof ApiError ? e.message : "Não foi possível entrar no grupo. Tente de novo.");
			setAccepting(false);
		}
	}

	if (loading) {
		return (
			<InviteShell>
				<div className="flex justify-center py-6 text-primary">
					<CircularProgress />
				</div>
			</InviteShell>
		);
	}

	if (!user) {
		return (
			<InviteShell>
				<GroupBadge />
				<h1 className="text-headline-small font-bold">Você foi convidado para um grupo no Pague Sua Parte</h1>
				<p className="text-body-large text-on-surface-variant">
					No Pague Sua Parte a família divide as despesas e paga uns aos outros por Pix. Entre com sua conta Google para ver o convite.
				</p>
				<SignInButton />
			</InviteShell>
		);
	}

	if (error) {
		return (
			<InviteShell>
				<span className="flex size-16 items-center justify-center rounded-full bg-error-container text-on-error-container">
					<Icon name="error" size={32} />
				</span>
				<h1 className="text-headline-small font-bold">Convite indisponível</h1>
				<p role="alert" className="text-body-large text-on-surface-variant">
					{error}
				</p>
				<div className="flex flex-col gap-2">
					<Button
						icon="refresh"
						onClick={() => {
							setError(null);
							setReloadKey((k) => k + 1);
						}}
						fullWidth
					>
						Tentar de novo
					</Button>
					<Button href="/app" variant="outlined" fullWidth>
						Ir para o início
					</Button>
				</div>
			</InviteShell>
		);
	}

	if (!invite) {
		return (
			<InviteShell>
				<div className="flex flex-col items-center gap-3 py-6 text-primary">
					<CircularProgress label="Abrindo o convite..." />
					<p className="text-body-large text-on-surface-variant">Abrindo o convite...</p>
				</div>
			</InviteShell>
		);
	}

	if (invite.alreadyMember) {
		return (
			<InviteShell>
				<GroupBadge />
				<h1 className="break-words text-headline-small font-bold">Você já está no grupo “{invite.groupName}”</h1>
				<p className="text-body-large text-on-surface-variant">{peopleLabel(invite.memberCount)} no grupo.</p>
				<Button href={`/app/grupos/${invite.groupId}`} fullWidth>
					Abrir o grupo
				</Button>
			</InviteShell>
		);
	}

	return (
		<InviteShell>
			<InviteReady
				groupName={invite.groupName}
				memberCount={invite.memberCount}
				accepting={accepting}
				acceptError={acceptError}
				onAccept={() => void accept()}
			/>
		</InviteShell>
	);
}
