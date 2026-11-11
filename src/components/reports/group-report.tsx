"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { helpCount } from "@/components/expenses/expense-list";
import { normalizeSummary, type ExpenseSummary } from "@/components/expenses/types";
import { Avatar, Button, Card, EmptyState, Icon, IconButton, List, SegmentedButton, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { todayISO } from "@/lib/ui/dates";
import {
	barPercent,
	barScale,
	FAIRNESS_EXPLANATION,
	fairnessWords,
	markerPercent,
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

/** Total do período e o medidor "Equilíbrio da família". */
function Headline({ data }: Readonly<{ data: ReportData }>) {
	const words = fairnessWords(data.fairnessPercent);
	return (
		<div className="space-y-4">
			<Card tone="high" className="p-5">
				<p className="text-title-medium text-on-surface-variant">Total do período</p>
				<p className="money text-display-small font-bold">{formatBRL(data.totalCents)}</p>
				<p className="text-body-large text-on-surface-variant">{data.expenseCount === 1 ? "em 1 despesa" : `em ${data.expenseCount} despesas`}</p>
			</Card>
			<Card tone="low" className="space-y-3 p-5">
				<p id="equilibrio-titulo" className="text-title-large">
					Equilíbrio da família: <span className="money">{data.fairnessPercent}%</span>
				</p>
				<div
					role="meter"
					aria-labelledby="equilibrio-titulo"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={data.fairnessPercent}
					aria-valuetext={`${data.fairnessPercent}%: ${words.label}`}
					className="h-4 overflow-hidden rounded-[4px] bg-surface-container-high"
				>
					<div className="h-full rounded-[4px] bg-primary" style={{ width: `${Math.max(data.fairnessPercent, data.fairnessPercent > 0 ? 2 : 0)}%` }} />
				</div>
				<p className="flex items-start gap-2 text-title-medium">
					<Icon name={data.fairnessPercent >= 85 ? "check" : "favorite"} size={22} className="mt-0.5 text-primary" />
					{words.label}
				</p>
				<p className="text-body-large text-on-surface-variant">{FAIRNESS_EXPLANATION}</p>
			</Card>
		</div>
	);
}

/** Uma pessoa: avatar, nome, valor, porcentagem, barra na escala comum e os fatos pequenos. */
function PersonRow({ person: p, scale, marker }: Readonly<{ person: ReportPerson; scale: number; marker: number }>) {
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
			<div aria-hidden="true" className="relative h-3 rounded-[4px] bg-surface-container-high">
				{width > 0 && <div className="h-full rounded-[4px] bg-primary" style={{ width: `${width}%` }} />}
				<span
					className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-on-surface shadow-[0_0_0_1px_var(--md-surface-container-low)]"
					style={{ left: `${marker}%` }}
				/>
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

/** "Quanto cada um contribuiu": todas as barras na mesma escala, com a marca da parte igual. */
export function ContributionList({ data }: Readonly<{ data: ReportData }>) {
	const scale = barScale(data.people, data.equalShareCents);
	const marker = markerPercent(data.equalShareCents, scale);
	return (
		<section aria-labelledby="quanto-cada-um" className="space-y-3">
			<h2 id="quanto-cada-um" className="text-title-large">
				Quanto cada um contribuiu
			</h2>
			<List>
				<li aria-hidden="true" className="px-4 pb-0 pt-3">
					<div className="relative h-9">
						<span className="absolute top-0 whitespace-nowrap text-sm font-medium" style={{ left: `${marker}%`, transform: `translateX(-${marker}%)` }}>
							parte igual: <span className="money">{formatBRL(data.equalShareCents)}</span>
						</span>
						<span className="absolute bottom-0 h-3 w-0.5 -translate-x-1/2 rounded-full bg-on-surface" style={{ left: `${marker}%` }} />
					</div>
				</li>
				{data.people.map((p) => (
					<PersonRow key={p.uid || p.name} person={p} scale={scale} marker={marker} />
				))}
			</List>
			<p className="text-sm text-on-surface-variant">
				A linha marca a parte igual: <span className="money">{formatBRL(data.equalShareCents)}</span> para cada um, se tudo fosse dividido por igual. As barras usam a mesma escala.
			</p>
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

/** Tela do relatório: período em cima, depois total, equilíbrio, contribuição de cada um e a ajuda. */
export function ReportView({
	groupId,
	state,
	period,
	onPeriod,
	waitingCount = 0,
	today = todayISO(),
}: Readonly<{
	groupId: string;
	state: ReportState;
	period: ReportPeriod;
	onPeriod: (p: ReportPeriod) => void;
	/** Despesas esperando ajuda (para o convite final). */
	waitingCount?: number;
	today?: string;
}>) {
	const gid = encodeURIComponent(groupId);
	const ready = state.kind === "ready" ? state.data : null;
	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<header className="space-y-1">
				<h1 className="text-headline-medium md:text-headline-large">Relatório</h1>
				<p className="text-body-large text-on-surface-variant">
					{ready?.groupName ? `${ready.groupName}: ` : ""}quanto cada pessoa já contribuiu com as despesas.
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
					Quando alguém lançar uma despesa, você vê aqui quanto cada um contribuiu.
				</EmptyState>
			)}
			{ready && ready.expenseCount > 0 && (
				<>
					<Headline data={ready} />
					<ContributionList data={ready} />
					{waitingCount > 0 && ready.fairnessPercent < 85 && (
						<Card as="section" aria-labelledby="quer-equilibrar" className="space-y-3 bg-primary-container! p-5 text-on-primary-container">
							<h2 id="quer-equilibrar" className="text-title-large">
								Quer equilibrar?
							</h2>
							<p className="text-body-large">
								{waitingCount === 1 ? "Tem 1 despesa esperando ajuda." : `Tem ${waitingCount} despesas esperando ajuda.`} Entrar na divisão deixa a parte de cada um menor.
							</p>
							<Button href={`/app/grupos/${gid}?ajuda=1`} icon="favorite" fullWidth className="md:w-auto">
								Ver despesas esperando ajuda
							</Button>
						</Card>
					)}
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
	const [waiting, setWaiting] = useState(0);
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

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ expenses: ExpenseSummary[] }>(`/api/groups/${encodeURIComponent(groupId)}/expenses`)
			.then((r) => {
				if (!cancelled) setWaiting(helpCount(r.expenses.map(normalizeSummary)));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [user, groupId]);

	return (
		<ReportView
			groupId={groupId}
			state={state}
			period={period}
			onPeriod={(p) => {
				setState({ kind: "loading" });
				setPeriod(p);
			}}
			waitingCount={waiting}
		/>
	);
}
