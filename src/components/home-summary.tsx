"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, Skeleton } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";

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

/** Resumo com os valores reais de `/api/me/summary`. */
export function HomeSummaryLive() {
	const { user } = useAuth();
	const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; receive: number; pay: number }>({ kind: "loading" });

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ toReceiveCents: number; toPayCents: number }>("/api/me/summary")
			.then((s) => {
				if (!cancelled) setState({ kind: "ready", receive: s.toReceiveCents, pay: s.toPayCents });
			})
			.catch(() => {
				if (!cancelled) setState({ kind: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [user]);

	return (
		<HomeSummary
			loading={state.kind === "loading"}
			receiveCents={state.kind === "ready" ? state.receive : null}
			payCents={state.kind === "ready" ? state.pay : null}
		/>
	);
}
