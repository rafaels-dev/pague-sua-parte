"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import Link from "next/link";
import { Avatar, Button, Card, Icon, Skeleton } from "@/components/ui";
import { GroupBalance } from "@/components/groups/groups-list";
import { apiFetch } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { todayISO } from "@/lib/ui/dates";
import { untilEndOfMonthLine } from "@/lib/ui/due-dates";
import { payAllUrl, receivablesUrl, scopedApiUrl } from "@/lib/ui/group-scope";
import { normalizeMeSummary, type MeSummary } from "@/lib/ui/managed";

/** Ação compacta em forma de link (28px, com área de toque maior), do mesmo jeito que o chip "Ver quem deve" de quem você cuida. */
const CHIP_LINK =
	"state-layer relative inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm font-medium before:absolute before:-inset-x-1 before:-inset-y-[10px] before:content-['']";
const CHIP_TONAL = `${CHIP_LINK} bg-secondary-container text-on-secondary-container`;

/** Há algo a pagar agora (a parte da pessoa ou de quem ela cuida)? Vale para o início e para um grupo. */
export function hasPayNow(s: MeSummary): boolean {
	return s.toPayNowCents + s.managed.reduce((sum, m) => sum + m.toPayNowCents, 0) > 0;
}

/**
 * Cartão-resumo da tela inicial: quanto a pessoa tem a receber e a pagar (em centavos).
 * `null` = não carregou: mostra "—" (nunca R$ 0,00, que diria que não há nada). `loading` mostra esqueletos.
 * Com `groupId` os botões levam às telas "Pagar tudo" / "Quem me deve" só desse grupo; `compact` é a versão menor da tela do grupo.
 */
export function HomeSummary({
	receiveCents,
	payCents,
	receiveNowCents,
	payNowCents,
	overdueCents = 0,
	payAll = false,
	receivable = false,
	loading = false,
	groupId,
	compact = false,
}: Readonly<{
	receiveCents: number | null;
	payCents: number | null;
	/** Parte do total sem vencimento ou vencendo até o fim do mês; só aparece quando difere do total. */
	receiveNowCents?: number | null;
	payNowCents?: number | null;
	/** O que a pessoa deve e já venceu. */
	overdueCents?: number;
	/** Há algo a pagar agora (sua parte ou de quem você cuida): mostra "Pagar tudo de uma vez". */
	payAll?: boolean;
	/** Há algo a receber: o valor vira um link para "Quem me deve". */
	receivable?: boolean;
	loading?: boolean;
	/** Restringe os atalhos a este grupo (a tela do grupo). */
	groupId?: string;
	/** Menos espaço e letra menor, para caber no topo da tela do grupo sem empurrar as despesas. */
	compact?: boolean;
}>) {
	const today = todayISO();
	const untilLine = (total: number | null, now: number | null | undefined) =>
		!loading && total !== null && now !== null && now !== undefined ? untilEndOfMonthLine(total, now, today) : null;
	const receiveUntil = untilLine(receiveCents, receiveNowCents);
	const payUntil = untilLine(payCents, payNowCents);
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
	if (compact) {
		// Versão do topo da tela do grupo: valores lado a lado e as ações numa linha de chips, para as despesas continuarem à vista.
		const small = (label: string, cents: number | null, color: string) => (
			<div className="min-w-0">
				<p className="text-sm text-on-surface-variant">{label}</p>
				{cents === null ? (
					<p className="money text-title-large font-bold text-on-surface-variant">—</p>
				) : (
					<p className={`money text-title-large font-bold ${color}`}>{formatBRL(cents)}</p>
				)}
			</div>
		);
		return (
			<Card as="section" tone="high" aria-label="Resumo do grupo" className="space-y-3 p-4">
				<div className="grid grid-cols-2 gap-x-4">
					{small("A receber", receiveCents, "text-receive")}
					<div className="border-l border-outline-variant pl-4">{small("A pagar", payCents, "text-pay")}</div>
				</div>
				{overdueCents > 0 && (
					<p className="flex items-center gap-1.5 text-sm font-medium text-error">
						<Icon name="warning" size={18} />
						<span className="money">{formatBRL(overdueCents)} vencido</span>
					</p>
				)}
				{(payAll || receivable) && (
					<div className="flex flex-wrap gap-x-2 gap-y-3">
						{payAll && (
							<Link href={payAllUrl(groupId)} className={CHIP_TONAL}>
								Pagar tudo de uma vez
							</Link>
						)}
						{receivable && (
							<Link href={receivablesUrl(groupId)} className={`${CHIP_LINK} border border-outline text-primary`}>
								Ver quem deve
							</Link>
						)}
					</div>
				)}
			</Card>
		);
	}
	return (
		<Card
			as="section"
			tone="high"
			aria-label="Resumo"
			aria-busy={loading || undefined}
			className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 md:p-8"
		>
			{receivable && !loading && receiveCents !== null && receiveCents > 0 ? (
				<Link href={receivablesUrl(groupId)} className="state-layer -m-2 block min-h-12 min-w-0 rounded-shape-md p-2 text-on-surface">
					<p className="text-body-large text-on-surface-variant">Você tem a receber</p>
					{value(receiveCents, "text-receive")}
					{receiveUntil && <p className="money mt-1 text-body-large text-on-surface-variant">{receiveUntil}</p>}
					<p className="mt-1 flex items-center text-title-medium text-primary">
						Ver quem deve
						<Icon name="chevron_right" size={22} />
					</p>
				</Link>
			) : (
				<div className="min-w-0">
					<p className="text-body-large text-on-surface-variant">Você tem a receber</p>
					{value(receiveCents, "text-receive")}
					{receiveUntil && <p className="money mt-1 text-body-large text-on-surface-variant">{receiveUntil}</p>}
				</div>
			)}
			<div className="min-w-0 border-l border-outline-variant pl-4 md:pl-8">
				<p className="text-body-large text-on-surface-variant">Você tem a pagar</p>
				{value(payCents, "text-pay")}
				{payUntil && <p className="money mt-1 text-body-large text-on-surface-variant">{payUntil}</p>}
			</div>
			{!loading && overdueCents > 0 && (
				<p className="col-span-2 flex items-center gap-2 border-t border-outline-variant pt-3 text-title-medium text-error">
					<Icon name="warning" size={22} />
					<span className="money">{formatBRL(overdueCents)} vencido</span>
				</p>
			)}
			{!loading && payAll && (
				<div className="col-span-2 border-t border-outline-variant pt-4">
					<Button href={payAllUrl(groupId)} variant="tonal" icon="qr_code" fullWidth>
						Pagar tudo de uma vez
					</Button>
				</div>
			)}
		</Card>
	);
}

/**
 * Um cartão compacto por pessoa sem celular que você cuida: o saldo dela, separado do seu. Toque leva ao grupo.
 * Com `groupId` (tela do grupo) só aparecem as pessoas desse grupo com algo a pagar ou a receber, sem o nome do grupo
 * nem o link para ele (a pessoa já está lá), e "Ver quem deve" abre só esse grupo.
 */
export function ManagedSummaryCards({ managed, groupId }: Readonly<{ managed: MeSummary["managed"]; groupId?: string }>) {
	const shown = groupId ? managed.filter((m) => m.groupId === groupId && (m.toPayCents > 0 || m.toReceiveCents > 0)) : managed;
	if (shown.length === 0) return null;
	const rowClass = "flex items-center gap-4 rounded-shape-lg text-on-surface";
	return (
		<section aria-label="Pessoas que você cuida" className={groupId ? "space-y-2" : "space-y-3"}>
			{shown.map((m) => (
				<div key={`${m.groupId}-${m.uid}`} className="rounded-shape-lg bg-surface-container-low">
					{(() => {
						const body = (
							<>
								<Avatar name={m.name} managed size={groupId ? "sm" : "md"} />
								<span className="min-w-0 flex-1">
									<span className="block break-words text-title-medium">
										{m.name} <span className="whitespace-nowrap font-normal">· você cuida</span>
									</span>
									{!groupId && m.groupName && <span className="block break-words text-body-large text-on-surface-variant">{m.groupName}</span>}
									<GroupBalance group={m} />
								</span>
							</>
						);
						return groupId ? (
							<div className={`${rowClass} min-h-12 px-4 py-2`}>{body}</div>
						) : (
							<Link href={`/app/grupos/${encodeURIComponent(m.groupId)}`} className={`state-layer ${rowClass} min-h-[4.5rem] px-4 py-3`}>
								{body}
								<Icon name="chevron_right" className="text-on-surface-variant" />
							</Link>
						);
					})()}
					{!groupId && m.toReceiveCents > 0 && (
						<div className="px-4 pb-3">
							<Link href={receivablesUrl(groupId)} className={CHIP_TONAL}>
								Ver quem deve
								<Icon name="chevron_right" size={16} />
							</Link>
						</div>
					)}
				</div>
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
			<HomeSummary
				loading={state.kind === "loading"}
				receiveCents={ready?.toReceiveCents ?? null}
				payCents={ready?.toPayCents ?? null}
				receiveNowCents={ready?.toReceiveNowCents}
				payNowCents={ready?.toPayNowCents}
				overdueCents={ready?.overdueToPayCents ?? 0}
				receivable={!!ready && ready.toReceiveCents > 0}
				payAll={!!ready && hasPayNow(ready)}
			/>
			{ready && <ManagedSummaryCards managed={ready.managed} />}
		</div>
	);
}

/**
 * O mesmo resumo do início, só de um grupo, para o topo da tela do grupo: a pagar / a receber, "Pagar tudo de uma vez",
 * "Ver quem deve" e quem você cuida. Sem nada a pagar nem a receber vira uma linha quieta. `summary` = null: não carregou
 * (o bloco some; a tela do grupo funciona sem ele).
 */
export function GroupSummaryView({ summary, groupId, loading = false }: Readonly<{ summary: MeSummary | null; groupId: string; loading?: boolean }>) {
	if (loading) {
		return (
			<div role="status">
				<span className="sr-only">Carregando o resumo...</span>
				<Skeleton className="h-28 rounded-shape-lg" />
			</div>
		);
	}
	if (!summary) return null;
	const managedBusy = summary.managed.some((m) => m.toPayCents > 0 || m.toReceiveCents > 0);
	if (summary.toPayCents <= 0 && summary.toReceiveCents <= 0 && !managedBusy) {
		return (
			<p className="flex items-center gap-2 text-body-large text-on-surface-variant">
				<Icon name="check" size={20} className="text-primary" />
				Tudo certo neste grupo.
			</p>
		);
	}
	return (
		<div className="space-y-2">
			<HomeSummary
				compact
				groupId={groupId}
				receiveCents={summary.toReceiveCents}
				payCents={summary.toPayCents}
				receiveNowCents={summary.toReceiveNowCents}
				payNowCents={summary.toPayNowCents}
				overdueCents={summary.overdueToPayCents}
				receivable={summary.toReceiveCents > 0 || summary.managed.some((m) => m.toReceiveCents > 0)}
				payAll={hasPayNow(summary)}
			/>
			<ManagedSummaryCards managed={summary.managed} groupId={groupId} />
		</div>
	);
}

/** Resumo de um grupo com os valores reais de `/api/me/summary?groupId=`. Se falhar, não mostra nada. */
export function GroupSummaryLive({ groupId }: Readonly<{ groupId: string }>) {
	const { user } = useAuth();
	const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; summary: MeSummary }>({ kind: "loading" });

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<unknown>(scopedApiUrl("/api/me/summary", groupId))
			.then((s) => {
				if (!cancelled) setState({ kind: "ready", summary: normalizeMeSummary(s) });
			})
			.catch(() => {
				if (!cancelled) setState({ kind: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId]);

	return <GroupSummaryView groupId={groupId} loading={state.kind === "loading"} summary={state.kind === "ready" ? state.summary : null} />;
}

