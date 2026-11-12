"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { SignInButton } from "@/components/auth/sign-in-button";
import { InviteShell } from "@/components/groups/invite-accept";
import { Banner, Button, CircularProgress, Icon } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatDateLong } from "@/lib/ui/dates";
import { inviteShareLine } from "@/lib/ui/plans";
import type { PlanInvitePreview } from "@/lib/plans/repo";

function PlanBadge() {
	return (
		<span className="flex size-16 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
			<Icon name="calendar_today" size={32} />
		</span>
	);
}

/** Convite pronto para aceitar (visual). */
export function PlanInviteReady({
	invite,
	accepting,
	acceptError,
	onAccept,
}: Readonly<{ invite: Pick<PlanInvitePreview, "planName" | "creatorName" | "totalCents" | "eventDate" | "allCount" | "shareIfAllCents">; accepting: boolean; acceptError: string | null; onAccept: () => void }>) {
	const estimate = inviteShareLine(invite.allCount, invite.shareIfAllCents);
	return (
		<>
			<PlanBadge />
			<div className="space-y-1">
				<p className="text-body-large text-on-surface-variant">{invite.creatorName} convidou você para o plano</p>
				<h1 className="break-words text-headline-medium font-bold">{invite.planName}</h1>
				<p className="money text-title-large">{formatBRL(invite.totalCents)}</p>
				{invite.eventDate && <p className="text-body-large text-on-surface-variant">Quando: {formatDateLong(invite.eventDate)}</p>}
				{estimate && <p className="text-body-large text-on-surface-variant">{estimate}</p>}
			</div>
			<p className="text-body-large text-on-surface-variant">Você diz se vai e, se quiser, até quanto pode pagar. Ninguém paga nada agora.</p>
			{acceptError && (
				<Banner tone="error" icon="error" role="alert">
					{acceptError}
				</Banner>
			)}
			<div className="flex flex-col gap-2">
				<Button onClick={onAccept} loading={accepting} fullWidth>
					{accepting ? "Entrando..." : "Participar do plano"}
				</Button>
				<Button href="/app" variant="text" size="md" fullWidth>
					Agora não
				</Button>
			</div>
		</>
	);
}

export function PlanInviteAccept({ token }: Readonly<{ token: string }>) {
	const router = useRouter();
	const { user, loading } = useAuth();
	const [invite, setInvite] = useState<PlanInvitePreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [accepting, setAccepting] = useState(false);
	const [acceptError, setAcceptError] = useState<string | null>(null);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<PlanInvitePreview>(`/api/plan-invites/${encodeURIComponent(token)}`)
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
			const res = await apiFetch<{ planId: string }>(`/api/plan-invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: JSON.stringify({}) });
			router.push(`/app/planos/${res.planId}`);
		} catch (e) {
			setAcceptError(e instanceof ApiError ? e.message : "Não foi possível entrar no plano. Tente de novo.");
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
				<PlanBadge />
				<h1 className="text-headline-small font-bold">Você foi convidado para um plano no PagueSuaParte</h1>
				<p className="text-body-large text-on-surface-variant">Entre com sua conta Google para ver o convite e dizer se você vai.</p>
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
	if (invite.alreadyParticipant) {
		return (
			<InviteShell>
				<PlanBadge />
				<h1 className="break-words text-headline-small font-bold">Você já está no plano “{invite.planName}”</h1>
				<Button href={`/app/planos/${invite.planId}`} fullWidth>
					Abrir o plano
				</Button>
			</InviteShell>
		);
	}
	return (
		<InviteShell>
			<PlanInviteReady invite={invite} accepting={accepting} acceptError={acceptError} onAccept={() => void accept()} />
		</InviteShell>
	);
}
