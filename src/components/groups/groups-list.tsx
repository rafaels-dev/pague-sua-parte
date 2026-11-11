"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button, EmptyState, Fab, Icon, List, ListItem, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { peopleLabel } from "@/lib/ui/invite";

export type GroupSummary = { id: string; name: string; memberCount: number; role: "admin" | "member" };

export type GroupsListState =
	| { kind: "loading" }
	| { kind: "error"; message: string; onRetry: () => void }
	| { kind: "ready"; groups: GroupSummary[] };

export function GroupsListView({ state }: Readonly<{ state: GroupsListState }>) {
	const hasGroups = state.kind === "ready" && state.groups.length > 0;
	return (
		<section className="space-y-3" aria-labelledby="grupos-titulo">
			<div className="flex min-h-12 items-center justify-between gap-4">
				<h2 id="grupos-titulo" className="text-title-large">
					Seus grupos
				</h2>
				{hasGroups && (
					<Button href="/app/grupos/novo" icon="add" size="md" variant="tonal" className="max-md:hidden">
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
				<>
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
								supporting={peopleLabel(g.memberCount)}
								trailing={<Icon name="chevron_right" />}
							/>
						))}
					</List>
					<Fab href="/app/grupos/novo" icon="add" className="md:hidden">
						Criar grupo
					</Fab>
				</>
			)}
		</section>
	);
}

export function GroupsList() {
	const { user } = useAuth();
	const [groups, setGroups] = useState<GroupSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ groups: GroupSummary[] }>("/api/groups")
			.then((data) => {
				if (!cancelled) setGroups(data.groups);
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

	return <GroupsListView state={state} />;
}
