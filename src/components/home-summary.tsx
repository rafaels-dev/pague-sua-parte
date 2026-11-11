"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import Link from "next/link";
import { Avatar, Card, Icon, Skeleton } from "@/components/ui";
import { GroupBalance } from "@/components/groups/groups-list";
import { apiFetch } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { normalizeMeSummary, type MeSummary } from "@/lib/ui/managed";

/**
 * Cartão-resumo da tela inicial: quanto a pessoa tem a receber e a pagar (em centavos).
 * `null` = não carregou: mostra "—" (nunca R$ 0,00, que diria que não há nada). `loading` mostra esqueletos.
 */
export function HomeSummary({
	receiveCents,
	payCents,
	loading = false,
}: Readonly<{ receiveCents: number | null; payCents: number | null; loading?: boolean }>) {
	const value = (cents: number | null, color: string) =>
		loading ? (
			<Skeleton className="mt-2 h-8 w-32 md:h-10" />
		) : cents === null ? (
			<p className="money mt-1 text-headline-small font-bold text-on-surface-variant md:text-headline-large md:font-bold">
				<span aria-hidden="true">—</span>
				<span className="sr-only">indisponível</span>
			</p>
		) : (
			<p className={`money mt-1 text-headline-small font-bold md:text-headline-large md:font-bold ${color}`}>{formatBRL(cents)}</p>
		);
	return (
		<Card as="section" tone="high" aria-label="Resumo" aria-busy={loading || undefined} className="grid grid-cols-2 gap-4 p-5 md:p-8">
			<div className="min-w-0">
				<p className="text-body-large text-on-surface-variant">Você tem a receber</p>
				{value(receiveCents, "text-receive")}
			</div>
			<div className="min-w-0 border-l border-outline-variant pl-4 md:pl-8">
				<p className="text-body-large text-on-surface-variant">Você tem a pagar</p>
				{value(payCents, "text-pay")}
			</div>
		</Card>
	);
}

/** Um cartão compacto por pessoa sem celular que você cuida: o saldo dela, separado do seu. Toque leva ao grupo. */
export function ManagedSummaryCards({ managed }: Readonly<{ managed: MeSummary["managed"] }>) {
	if (managed.length === 0) return null;
	return (
		<section aria-label="Pessoas que você cuida" className="space-y-3">
			{managed.map((m) => (
				<Link
					key={`${m.groupId}-${m.uid}`}
					href={`/app/grupos/${encodeURIComponent(m.groupId)}`}
					className="state-layer flex min-h-[4.5rem] items-center gap-4 rounded-shape-lg bg-surface-container-low px-4 py-3 text-on-surface"
				>
					<Avatar name={m.name} managed />
					<span className="min-w-0 flex-1">
						<span className="block break-words text-title-medium">
							{m.name} <span className="whitespace-nowrap font-normal">· você cuida</span>
						</span>
						{m.groupName && <span className="block break-words text-body-large text-on-surface-variant">{m.groupName}</span>}
						<GroupBalance group={m} />
					</span>
					<Icon name="chevron_right" className="text-on-surface-variant" />
				</Link>
			))}
		</section>
	);
}

/** Resumo com os valores reais de `/api/me/summary`, mais os cartões de quem você cuida. */
export function HomeSummaryLive() {
	const { user } = useAuth();
	const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; summary: MeSummary }>({ kind: "loading" });

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<unknown>("/api/me/summary")
			.then((s) => {
				if (!cancelled) setState({ kind: "ready", summary: normalizeMeSummary(s) });
			})
			.catch(() => {
				if (!cancelled) setState({ kind: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [user]);

	const ready = state.kind === "ready" ? state.summary : null;
	return (
		<div className="space-y-3">
			<HomeSummary loading={state.kind === "loading"} receiveCents={ready?.toReceiveCents ?? null} payCents={ready?.toPayCents ?? null} />
			{ready && <ManagedSummaryCards managed={ready.managed} />}
		</div>
	);
}

