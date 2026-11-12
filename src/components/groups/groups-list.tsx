"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { Button, EmptyState, Fab, Icon, List, ListItem, Sheet, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { compactBalanceLine } from "@/lib/ui/due-dates";
import { peopleLabel } from "@/lib/ui/invite";

export type GroupSummary = {
	id: string;
	name: string;
	memberCount: number;
	role: "admin" | "member";
	/** Quanto a pessoa tem a receber neste grupo (inclui devoluções). */
	toReceiveCents: number;
	/** Quanto a pessoa tem a pagar neste grupo (inclui devoluções). */
	toPayCents: number;
	/** Sem vencimento ou vencendo até o fim do mês. */
	toReceiveNowCents: number;
	toPayNowCents: number;
	/** O que a pessoa deve e já venceu. */
	overdueToPayCents: number;
};

export type GroupsListState =
	| { kind: "loading" }
	| { kind: "error"; message: string; onRetry: () => void }
	| { kind: "ready"; groups: GroupSummary[] };

/** Completa o saldo quando o servidor ainda manda o formato antigo. */
export function normalizeGroup(g: Partial<GroupSummary> & Pick<GroupSummary, "id" | "name" | "memberCount" | "role">): GroupSummary {
	const toReceiveCents = g.toReceiveCents ?? 0;
	const toPayCents = g.toPayCents ?? 0;
	return {
		...g,
		toReceiveCents,
		toPayCents,
		toReceiveNowCents: g.toReceiveNowCents ?? toReceiveCents,
		toPayNowCents: g.toPayNowCents ?? toPayCents,
		overdueToPayCents: g.overdueToPayCents ?? 0,
	};
}

/**
 * Saldo do grupo em palavras: "A receber R$ X", "A pagar R$ Y" ou "Tudo em dia", mais UMA linha extra
 * quando há vencido ou quando o que vale para este mês difere do total.
 */
export function GroupBalance({
	group: g,
}: Readonly<{ group: Pick<GroupSummary, "toReceiveCents" | "toPayCents"> & Partial<Pick<GroupSummary, "toReceiveNowCents" | "toPayNowCents" | "overdueToPayCents">> }>) {
	if (g.toReceiveCents <= 0 && g.toPayCents <= 0) return <span className="block text-on-surface-variant">Tudo em dia</span>;
	const extra = compactBalanceLine({
		toReceiveCents: g.toReceiveCents,
		toPayCents: g.toPayCents,
		toReceiveNowCents: g.toReceiveNowCents ?? g.toReceiveCents,
		toPayNowCents: g.toPayNowCents ?? g.toPayCents,
		overdueToPayCents: g.overdueToPayCents ?? 0,
	});
	return (
		<>
			<span className="flex flex-wrap gap-x-4 font-medium">
				{g.toReceiveCents > 0 && <span className="money text-receive">A receber {formatBRL(g.toReceiveCents)}</span>}
				{g.toPayCents > 0 && <span className="money text-error">A pagar {formatBRL(g.toPayCents)}</span>}
			</span>
			{extra && <span className={`money block text-sm ${extra.tone === "error" ? "font-medium text-error" : "text-on-surface-variant"}`}>{extra.text}</span>}
		</>
	);
}

/** Sheet "Em qual grupo?": só é aberto quando a pessoa tem mais de um grupo. */
export function ChooseGroupSheet({ open, onClose, groups }: Readonly<{ open: boolean; onClose: () => void; groups: GroupSummary[] }>) {
	return (
		<Sheet open={open} onClose={onClose} title="Em qual grupo?">
			<div className="space-y-4">
				<List>
					{groups.map((g) => (
						<ListItem
							key={g.id}
							href={`/app/grupos/${encodeURIComponent(g.id)}/despesas/nova`}
							leading={
								<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
									<Icon name="group" />
								</span>
							}
							headline={g.name}
							supporting={peopleLabel(g.memberCount)}
							trailing={<Icon name="chevron_right" />}
						/>
					))}
				</List>
				<Button variant="text" size="md" onClick={onClose} fullWidth>
					Cancelar
				</Button>
			</div>
		</Sheet>
	);
}

/** Seção "Seus grupos" com o saldo de cada um e a ação principal da tela inicial, "Lançar despesa". */
export function GroupsListView({ state, onPostExpense }: Readonly<{ state: GroupsListState; onPostExpense?: () => void }>) {
	const ready = state.kind === "ready";
	const hasGroups = ready && state.groups.length > 0;
	// Sem grupo, a ação principal é "Criar grupo" (já no meio da tela): "Lançar despesa" só aparece quando há onde lançar.
	const canPost = hasGroups && !!onPostExpense;
	return (
		<div className="space-y-6">
			{canPost && (
				<div className="max-md:hidden">
					<Button icon="add" onClick={onPostExpense}>
						Lançar despesa
					</Button>
				</div>
			)}

			<section className="space-y-3" aria-labelledby="grupos-titulo">
				<div className="flex min-h-12 items-center justify-between gap-4">
					<h2 id="grupos-titulo" className="text-title-large">
						Seus grupos
					</h2>
					{hasGroups && (
						<Button href="/app/grupos/novo" icon="add" size="md" variant="tonal">
							Criar grupo
						</Button>
					)}
				</div>

				{state.kind === "error" ? (
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
				) : state.kind === "loading" ? (
					<div role="status" className="space-y-3">
						<span className="sr-only">Carregando...</span>
						<Skeleton className="h-[4.5rem] rounded-shape-md" />
						<Skeleton className="h-[4.5rem] rounded-shape-md" />
						<Skeleton className="h-[4.5rem] rounded-shape-md" />
					</div>
				) : state.groups.length === 0 ? (
					<EmptyState
						icon="group"
						className="rounded-shape-lg bg-surface-container-low"
						action={
							<Button href="/app/grupos/novo" icon="add">
								Criar grupo
							</Button>
						}
					>
						Um grupo reúne as pessoas que dividem as despesas, como a família ou a viagem. Crie o primeiro e convide quem quiser.
					</EmptyState>
				) : (
					<List grid>
						{state.groups.map((g) => (
							<ListItem
								key={g.id}
								href={`/app/grupos/${g.id}`}
								leading={
									<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
										<Icon name="group" />
									</span>
								}
								headline={g.name}
								supporting={
									<>
										<span className="block">{peopleLabel(g.memberCount)}</span>
										<GroupBalance group={g} />
									</>
								}
								trailing={<Icon name="chevron_right" />}
							/>
						))}
					</List>
				)}
			</section>

			{canPost && (
				<Fab onClick={onPostExpense} icon="add" className="md:hidden">
					Lançar despesa
				</Fab>
			)}
		</div>
	);
}

export function GroupsList() {
	const { user } = useAuth();
	const router = useRouter();
	const [groups, setGroups] = useState<GroupSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [choosing, setChoosing] = useState(false);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ groups: (Partial<GroupSummary> & Pick<GroupSummary, "id" | "name" | "memberCount" | "role">)[] }>("/api/groups")
			.then((data) => {
				if (!cancelled) setGroups(data.groups.map(normalizeGroup));
			})
			.catch((e) => {
				if (!cancelled) setError(e instanceof ApiError ? e.message : "Não foi possível carregar seus grupos.");
			});
		return () => {
			cancelled = true;
		};
	}, [user, reloadKey]);

	const state: GroupsListState = error
		? {
				kind: "error",
				message: error,
				onRetry: () => {
					setError(null);
					setGroups(null);
					setReloadKey((k) => k + 1);
				},
			}
		: groups === null
			? { kind: "loading" }
			: { kind: "ready", groups };

	// Um grupo só: direto para a despesa nova. Vários: pergunta qual. Nenhum: o botão nem aparece (a ação é "Criar grupo").
	function postExpense() {
		if (!groups) return;
		if (groups.length === 1) router.push(`/app/grupos/${encodeURIComponent(groups[0].id)}/despesas/nova`);
		else setChoosing(true);
	}

	return (
		<>
			<GroupsListView state={state} onPostExpense={postExpense} />
			<ChooseGroupSheet open={choosing} onClose={() => setChoosing(false)} groups={groups ?? []} />
		</>
	);
}
