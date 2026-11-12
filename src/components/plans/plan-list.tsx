"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Banner, Button, Icon, Skeleton, StatusChip } from "@/components/ui";
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

/** Seção "Planos" do início: os planos em andamento, "Planejar despesa" e, discreto, "Ver planos antigos". */
export function PlansSectionView({
	plans,
	oldPlans,
	loading,
	oldLoading,
	error,
	onRetry,
	onToggleOld,
}: Readonly<{
	plans: PlanSummary[];
	oldPlans: PlanSummary[] | null;
	loading: boolean;
	oldLoading?: boolean;
	/** Falha ao carregar: mostra o erro com "Tentar de novo" (e não a lista vazia, que diria que não há planos). */
	error?: string | null;
	onRetry?: () => void;
	onToggleOld: () => void;
}>) {
	return (
		<section className="space-y-3" aria-labelledby="titulo-planos">
			<h2 id="titulo-planos" className="text-title-large">
				Planos
			</h2>
			{error ? (
				<Banner tone="error" icon="error" role="alert" action={onRetry ? <Button variant="outlined" size="md" icon="refresh" onClick={onRetry}>Tentar de novo</Button> : undefined}>
					{error}
				</Banner>
			) : loading ? (
				<Skeleton className="h-[4.5rem] rounded-shape-md" />
			) : plans.length > 0 ? (
				<ul className="space-y-3">
					{plans.map((p) => (
						<PlanCard key={p.id} plan={p} />
					))}
				</ul>
			) : (
				<p className="text-body-large text-on-surface-variant">Vai dividir um gasto grande, como uma viagem? Pergunte antes quem vai.</p>
			)}
			<Button href="/app/planos/novo" variant="tonal" icon="add" fullWidth className="md:w-auto">
				Planejar despesa
			</Button>
			<div>
				<Button variant="text" size="md" onClick={onToggleOld} className="-ml-4">
					{oldPlans ? "Esconder planos antigos" : "Ver planos antigos"}
				</Button>
			</div>
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
	const [oldPlans, setOldPlans] = useState<PlanSummary[] | null>(null);
	const [oldLoading, setOldLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ plans: PlanSummary[] }>("/api/plans")
			.then((d) => {
				if (cancelled) return;
				setError(null);
				setPlans(d.plans);
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
			onRetry={() => {
				setError(null);
				setPlans(null);
				setReloadKey((k) => k + 1);
			}}
			onToggleOld={toggleOld}
		/>
	);
}
