"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Banner, Button, Icon, List, ListItem, Skeleton, StatusChip } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatDateShort } from "@/lib/ui/dates";
import { summaryLine } from "@/lib/ui/plans";
import type { PlanSummary } from "@/lib/plans/view";

function PlanCard({ plan }: Readonly<{ plan: PlanSummary }>) {
	return (
		<li>
			<Link
				href={`/app/planos/${encodeURIComponent(plan.id)}`}
				className="state-layer flex min-h-[4.5rem] items-center gap-3 rounded-shape-md bg-surface-container-low px-4 py-3"
			>
				<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
					<Icon name="calendar_today" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block break-words text-title-medium">{plan.name}</span>
					<span className="block text-body-large text-on-surface-variant">
						<span className="money">{formatBRL(plan.totalCents)}</span> · {summaryLine(plan)}
						{plan.eventDate && <> · {formatDateShort(plan.eventDate)}</>}
					</span>
					{plan.status === "open" && (
						<span className="mt-1 flex flex-wrap gap-2">
							{plan.needsMyAnswer ? <StatusChip tone="owe">Falta você responder</StatusChip> : <StatusChip tone="ok">Você já respondeu</StatusChip>}
						</span>
					)}
				</span>
				<Icon name="chevron_right" className="text-on-surface-variant" />
			</Link>
		</li>
	);
}

const VISIBLE_PLANS = 3;

/**
 * Seção "Planos" do início. Sem planos, é só uma linha convidando a planejar (sem título, para não pesar a tela).
 * Com planos: título com o botão "Planejar despesa", os três primeiros e "Ver todos"; "Ver planos antigos" fica discreto no fim.
 */
export function PlansSectionView({
	plans,
	oldPlans,
	loading,
	oldLoading,
	error,
	hasOld = false,
	onRetry,
	onToggleOld,
}: Readonly<{
	plans: PlanSummary[];
	oldPlans: PlanSummary[] | null;
	loading: boolean;
	oldLoading?: boolean;
	/** Falha ao carregar: mostra o erro com "Tentar de novo" (e não a lista vazia, que diria que não há planos). */
	error?: string | null;
	/** Há planos antigos (a API avisa): só então aparece "Ver planos antigos". */
	hasOld?: boolean;
	onRetry?: () => void;
	onToggleOld: () => void;
}>) {
	const [showAll, setShowAll] = useState(false);
	const empty = !error && !loading && plans.length === 0;
	// Voltou a ter poucos planos: a lista recolhe sozinha (ajuste de estado durante a renderização, como a documentação do React indica).
	if (showAll && plans.length <= VISIBLE_PLANS) setShowAll(false);
	const shown = showAll ? plans : plans.slice(0, VISIBLE_PLANS);
	return (
		<section className="space-y-3" aria-labelledby="titulo-planos">
			{empty ? (
				<>
					<h2 id="titulo-planos" className="sr-only">
						Planos
					</h2>
					<List>
						<ListItem
							href="/app/planos/novo"
							leading={
								<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
									<Icon name="calendar_today" />
								</span>
							}
							headline="Planejar despesa"
							supporting="Vai dividir um gasto grande, como uma viagem? Pergunte antes quem vai."
							trailing={<Icon name="chevron_right" />}
						/>
					</List>
				</>
			) : (
				<div className="flex min-h-12 items-center justify-between gap-4">
					<h2 id="titulo-planos" className="text-title-large">
						Planos
					</h2>
					<Button href="/app/planos/novo" icon="add" size="md" variant="tonal">
						Planejar despesa
					</Button>
				</div>
			)}
			{error ? (
				<Banner tone="error" icon="error" role="alert" action={onRetry ? <Button variant="outlined" size="md" icon="refresh" onClick={onRetry}>Tentar de novo</Button> : undefined}>
					{error}
				</Banner>
			) : loading ? (
				<Skeleton className="h-[4.5rem] rounded-shape-md" />
			) : (
				plans.length > 0 && (
					<>
						<ul className="space-y-3">
							{shown.map((p) => (
								<PlanCard key={p.id} plan={p} />
							))}
						</ul>
						{plans.length > VISIBLE_PLANS && (
							<Button variant="text" size="md" onClick={() => setShowAll((v) => !v)} className="-ml-4">
								{showAll ? "Mostrar menos" : `Ver todos (${plans.length})`}
							</Button>
						)}
					</>
				)
			)}
			{(hasOld || oldPlans) && (
				<div>
					<Button variant="quiet" size="md" onClick={onToggleOld} className="-ml-4">
						{oldPlans ? "Esconder planos antigos" : "Ver planos antigos"}
					</Button>
				</div>
			)}
			{oldLoading && <Skeleton className="h-[4.5rem] rounded-shape-md" />}
			{oldPlans &&
				(oldPlans.length > 0 ? (
					<ul className="space-y-3">
						{oldPlans.map((p) => (
							<PlanCard key={p.id} plan={p} />
						))}
					</ul>
				) : (
					<p className="text-body-large text-on-surface-variant">Nenhum plano antigo.</p>
				))}
		</section>
	);
}

export function PlansSection() {
	const { user } = useAuth();
	const [plans, setPlans] = useState<PlanSummary[] | null>(null);
	const [hasOld, setHasOld] = useState(false);
	const [oldPlans, setOldPlans] = useState<PlanSummary[] | null>(null);
	const [oldLoading, setOldLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ plans: PlanSummary[]; hasOld?: boolean }>("/api/plans")
			.then((d) => {
				if (cancelled) return;
				setError(null);
				setPlans(d.plans);
				setHasOld(d.hasOld === true);
			})
			.catch((e) => {
				if (!cancelled) setError(e instanceof ApiError ? e.message : "Não foi possível carregar seus planos.");
			});
		return () => {
			cancelled = true;
		};
	}, [user, reloadKey]);

	function toggleOld() {
		if (oldPlans) return setOldPlans(null);
		setOldLoading(true);
		setError(null);
		apiFetch<{ plans: PlanSummary[] }>("/api/plans?escopo=antigos")
			.then((d) => setOldPlans(d.plans))
			.catch((e) => setError(e instanceof ApiError ? e.message : "Não foi possível carregar os planos antigos."))
			.finally(() => setOldLoading(false));
	}

	return (
		<PlansSectionView
			plans={plans ?? []}
			oldPlans={oldPlans}
			loading={plans === null && !error}
			oldLoading={oldLoading}
			error={error}
			hasOld={hasOld}
			onRetry={() => {
				setError(null);
				setPlans(null);
				setReloadKey((k) => k + 1);
			}}
			onToggleOld={toggleOld}
		/>
	);
}
