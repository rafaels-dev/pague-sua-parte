"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Avatar, Button, Card, EmptyState, IconButton, List, SegmentedButton, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { todayISO } from "@/lib/ui/dates";
import {
	barPercent,
	barScale,
	monthLabel,
	monthShort,
	normalizeReport,
	percentText,
	periodFor,
	periodKind,
	periodLabel,
	personCaption,
	personFacts,
	shortBRL,
	stepMonthPeriod,
	type PeriodKind,
	type ReportData,
	type ReportPeriod,
	type ReportPerson,
} from "@/lib/ui/report";

export type ReportState =
	| { kind: "loading" }
	| { kind: "error"; message: string; onRetry: () => void }
	| { kind: "unavailable"; onRetry: () => void }
	| { kind: "ready"; data: ReportData };

const KINDS = [
	{ value: "all", label: "Tudo" },
	{ value: "month", label: "Este mês" },
	{ value: "year", label: "Este ano" },
] as const;

/** Escolha do período: Tudo / Este mês / Este ano, e setas de mês anterior e seguinte quando é um mês. */
function PeriodControl({ period, today, onPeriod }: Readonly<{ period: ReportPeriod; today: string; onPeriod: (p: ReportPeriod) => void }>) {
	const kind = periodKind(period);
	const prev = stepMonthPeriod(period, -1, today);
	const next = stepMonthPeriod(period, 1, today);
	return (
		<div className="space-y-2">
			<SegmentedButton<PeriodKind> label="Período" value={kind} options={KINDS} onChange={(k) => onPeriod(periodFor(k, today))} />
			{kind === "month" ? (
				<div className="flex items-center justify-between gap-2">
					<IconButton icon="chevron_left" label="Mês anterior" onClick={() => prev && onPeriod(prev)} />
					<p aria-live="polite" className="min-w-0 flex-1 text-center text-title-medium">
						{periodLabel(period)}
					</p>
					<span className={next ? "" : "invisible"}>
						<IconButton icon="chevron_right" label="Mês seguinte" onClick={() => next && onPeriod(next)} />
					</span>
				</div>
			) : (
				<p aria-live="polite" className="text-center text-title-medium text-on-surface-variant">
					{periodLabel(period)}
				</p>
			)}
		</div>
	);
}

/** Total do período. */
function Headline({ data }: Readonly<{ data: ReportData }>) {
	return (
		<Card tone="high" className="p-5">
			<p className="text-title-medium text-on-surface-variant">Total do período</p>
			<p className="money text-display-small font-bold">{formatBRL(data.totalCents)}</p>
			<p className="text-body-large text-on-surface-variant">{data.expenseCount === 1 ? "em 1 despesa" : `em ${data.expenseCount} despesas`}</p>
		</Card>
	);
}

/** Uma pessoa: avatar, nome, valor, porcentagem, barra na escala comum e os fatos pequenos. */
function PersonRow({ person: p, scale }: Readonly<{ person: ReportPerson; scale: number }>) {
	const caption = personCaption(p);
	const facts = personFacts(p);
	const width = barPercent(p.bornCents, scale);
	return (
		<li className="space-y-2 px-4 py-3">
			<div className="flex items-start gap-3">
				<Avatar name={p.name} src={p.picture} size="sm" managed={p.kind === "managed"} />
				<div className="min-w-0 flex-1 pt-0.5">
					<p className="break-words text-body-large font-medium">
						{p.name}
						{p.isYou && <span className="font-normal text-on-surface-variant"> (você)</span>}
					</p>
					{caption && <p className="text-sm text-on-surface-variant">{caption}</p>}
				</div>
				<div className="shrink-0 text-right">
					<p className="money text-title-medium">{formatBRL(p.bornCents)}</p>
					<p className="text-sm text-on-surface-variant">{percentText(p.bornPercent)} do total</p>
				</div>
			</div>
			<div aria-hidden="true" className="h-3 rounded-[4px] bg-surface-container-high">
				{width > 0 && <div className="h-full rounded-[4px] bg-primary" style={{ width: `${width}%` }} />}
			</div>
			{facts.length > 0 && (
				<ul className="space-y-0.5 text-sm text-on-surface-variant">
					{facts.map((f) => (
						<li key={f}>{f}</li>
					))}
				</ul>
			)}
		</li>
	);
}

/** "Quem pagou mais": do que mais pagou para o que menos pagou, com as barras na mesma escala. */
export function ContributionList({ data }: Readonly<{ data: ReportData }>) {
	const scale = barScale(data.people);
	return (
		<section aria-labelledby="quanto-cada-um" className="space-y-3">
			<h2 id="quanto-cada-um" className="text-title-large">
				Quem pagou mais
			</h2>
			<List>
				{data.people.map((p) => (
					<PersonRow key={p.uid || p.name} person={p} scale={scale} />
				))}
			</List>
			<p className="text-sm text-on-surface-variant">Em ordem, de quem pagou mais para quem pagou menos.</p>
		</section>
	);
}

/** Total por mês, em colunas simples (até os 6 últimos meses). */
export function MonthStrip({ months, today }: Readonly<{ months: ReportData["months"]; today: string }>) {
	if (months.length < 2) return null;
	const shown = months.slice(-6);
	const max = Math.max(...shown.map((m) => m.totalCents), 1);
	return (
		<section aria-labelledby="mes-a-mes" className="space-y-3">
			<h2 id="mes-a-mes" className="text-title-large">
				Mês a mês (em reais)
			</h2>
			<Card tone="low" className="p-4">
				<ul className="flex items-end gap-2">
					{shown.map((m) => (
						<li key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(m.month)}: ${formatBRL(m.totalCents)}`}>
							<span className="money text-xs text-on-surface-variant">{shortBRL(m.totalCents)}</span>
							<span aria-hidden="true" className="flex h-24 w-full items-end">
								<span className="w-full rounded-t-[4px] bg-primary" style={{ height: `${Math.max(3, (m.totalCents / max) * 100)}%` }} />
							</span>
							<span className="text-sm">{monthShort(m.month, today)}</span>
							<span className="sr-only">
								{monthLabel(m.month)}: {formatBRL(m.totalCents)}
							</span>
						</li>
					))}
				</ul>
			</Card>
		</section>
	);
}

export function ReportSkeleton() {
	return (
		<div role="status" className="space-y-4">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-32 rounded-shape-lg" />
			<Skeleton className="h-44 rounded-shape-lg" />
			<Skeleton className="h-64 rounded-shape-lg" />
		</div>
	);
}

/** Tela do relatório: período em cima, depois o total, quem pagou mais e o mês a mês. */
export function ReportView({
	groupId,
	state,
	period,
	onPeriod,
	today = todayISO(),
}: Readonly<{
	groupId: string;
	state: ReportState;
	period: ReportPeriod;
	onPeriod: (p: ReportPeriod) => void;
	today?: string;
}>) {
	const gid = encodeURIComponent(groupId);
	const ready = state.kind === "ready" ? state.data : null;
	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<header className="space-y-1">
				<h1 className="text-headline-medium md:text-headline-large">Relatório</h1>
				<p className="text-body-large text-on-surface-variant">
					{ready?.groupName ? `${ready.groupName}: ` : ""}quem pagou mais e quem pagou menos.
				</p>
			</header>

			<PeriodControl period={period} today={today} onPeriod={onPeriod} />

			{state.kind === "loading" && <ReportSkeleton />}
			{state.kind === "error" && (
				<EmptyState
					tone="error"
					icon="error"
					role="alert"
					title="Ops!"
					action={
						<Button icon="refresh" onClick={state.onRetry}>
							Tentar de novo
						</Button>
					}
				>
					{state.message}
				</EmptyState>
			)}
			{state.kind === "unavailable" && (
				<EmptyState
					icon="bar_chart"
					title="Relatório ainda não disponível"
					className="rounded-shape-lg bg-surface-container-low"
					action={
						<Button icon="refresh" variant="outlined" onClick={state.onRetry}>
							Tentar de novo
						</Button>
					}
				>
					Estamos preparando o relatório. Volte daqui a pouco.
				</EmptyState>
			)}
			{ready && ready.expenseCount === 0 && (
				<EmptyState
					icon="receipt_long"
					title="Nenhuma despesa neste período"
					className="rounded-shape-lg bg-surface-container-low"
					action={
						period === "all" ? (
							<Button href={`/app/grupos/${gid}/despesas/nova`} icon="add">
								Lançar despesa
							</Button>
						) : (
							<Button variant="outlined" onClick={() => onPeriod("all")}>
								Ver todo o período
							</Button>
						)
					}
				>
					Quando alguém lançar uma despesa, você vê aqui quem pagou mais e quem pagou menos.
				</EmptyState>
			)}
			{ready && ready.expenseCount > 0 && (
				<>
					<Headline data={ready} />
					<ContributionList data={ready} />
					<MonthStrip months={ready.months} today={today} />
				</>
			)}
		</div>
	);
}

/** Busca o relatório do grupo no período escolhido. */
export function GroupReport({ groupId }: Readonly<{ groupId: string }>) {
	const { user } = useAuth();
	const [period, setPeriod] = useState<ReportPeriod>("all");
	const [state, setState] = useState<ReportState>({ kind: "loading" });
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		const retry = () => {
			setState({ kind: "loading" });
			setReloadKey((k) => k + 1);
		};
		apiFetch<unknown>(`/api/groups/${encodeURIComponent(groupId)}/report?period=${encodeURIComponent(period)}`)
			.then((raw) => {
				if (cancelled) return;
				const data = normalizeReport(raw);
				setState(data ? { kind: "ready", data } : { kind: "unavailable", onRetry: retry });
			})
			.catch((e) => {
				if (cancelled) return;
				if (e instanceof ApiError && (e.status === 404 || e.status === 501)) setState({ kind: "unavailable", onRetry: retry });
				else setState({ kind: "error", message: e instanceof ApiError ? e.message : "Não foi possível carregar o relatório.", onRetry: retry });
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId, period, reloadKey]);

	return (
		<ReportView
			groupId={groupId}
			state={state}
			period={period}
			onPeriod={(p) => {
				setState({ kind: "loading" });
				setPeriod(p);
			}}
		/>
	);
}
