"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button, EmptyState, Fab, Icon, List, ListItem, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatDateShort } from "@/lib/ui/dates";
import { listStatus, paidByLabel } from "@/lib/ui/expense-status";
import { managedLines, ownerViewStatus } from "@/lib/ui/managed";
import { cx } from "@/lib/ui/cx";
import { normalizeSummary, type ExpenseSummary } from "./types";

export type ExpenseListState =
	| { kind: "loading" }
	| { kind: "error"; message: string; onRetry: () => void }
	| { kind: "ready"; expenses: ExpenseSummary[] };

const STATUS_COLOR = { owe: "text-error", wait: "text-on-surface-variant", ok: "text-receive" } as const;

/** Seção "Despesas" da tela do grupo: lista, estado vazio e a ação "Lançar despesa" (botão em telas largas, FAB no celular). */
export function ExpenseListView({ groupId, state }: Readonly<{ groupId: string; state: ExpenseListState }>) {
	const newHref = `/app/grupos/${encodeURIComponent(groupId)}/despesas/nova`;
	const hasItems = state.kind === "ready" && state.expenses.length > 0;
	return (
		<section className="space-y-3" aria-labelledby="despesas-titulo">
			<div className="flex min-h-12 items-center justify-between gap-4">
				<h2 id="despesas-titulo" className="text-title-large">
					Despesas
				</h2>
				{hasItems && (
					<Button href={newHref} icon="add" size="md" className="max-md:hidden">
						Lançar despesa
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
					<Skeleton className="h-24 rounded-shape-md" />
					<Skeleton className="h-24 rounded-shape-md" />
					<Skeleton className="h-24 rounded-shape-md" />
				</div>
			) : state.expenses.length === 0 ? (
				<EmptyState
					icon="receipt_long"
					title="Nenhuma despesa ainda"
					className="rounded-shape-lg bg-surface-container-low"
					action={
						<Button href={newHref} icon="add">
							Lançar a primeira despesa
						</Button>
					}
				>
					Pagou uma consulta, um remédio ou uma conta? Lance aqui e a gente divide o valor entre as pessoas.
				</EmptyState>
			) : (
				<>
					<List>
						{state.expenses.map((e) => {
							const status = listStatus(e);
							const extra = [
								...(e.ownerView ? [ownerViewStatus(e.paidBy.name, e.ownerView)] : []),
								...managedLines(e.managed),
							];
							return (
								<ListItem
									key={e.id}
									href={`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(e.id)}`}
									leading={
										<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
											<Icon name="receipt_long" />
										</span>
									}
									headline={e.description}
									supporting={
										<>
											<span className="block text-on-surface-variant">
												{paidByLabel({ name: e.paidBy.name, isYou: e.paidBy.isYou })} · {formatDateShort(e.date)}
											</span>
											{status && <span className={cx("block font-medium", STATUS_COLOR[status.tone])}>{status.text}</span>}
											{extra.map((l) => (
												<span key={l.text} className={cx("block font-medium", STATUS_COLOR[l.tone])}>
													{l.text}
												</span>
											))}
										</>
									}
									trailing={
										<span className="flex flex-col items-end gap-1">
											<span className="money text-title-medium text-on-surface">{formatBRL(e.amountCents)}</span>
											{e.attachmentCount > 0 && (
												<span className="flex items-center gap-1 text-sm">
													<Icon name="attach_file" size={18} />
													<span className="sr-only">{e.attachmentCount === 1 ? "1 anexo" : `${e.attachmentCount} anexos`}</span>
													<span aria-hidden="true">{e.attachmentCount}</span>
												</span>
											)}
										</span>
									}
								/>
							);
						})}
					</List>
					<Fab href={newHref} icon="add" className="md:hidden">
						Lançar despesa
					</Fab>
				</>
			)}
		</section>
	);
}

/** Busca as despesas do grupo e mostra a lista. */
export function ExpenseList({ groupId }: Readonly<{ groupId: string }>) {
	const { user } = useAuth();
	const [state, setState] = useState<ExpenseListState>({ kind: "loading" });
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<{ expenses: ExpenseSummary[] }>(`/api/groups/${encodeURIComponent(groupId)}/expenses`)
			.then((r) => {
				if (!cancelled) setState({ kind: "ready", expenses: r.expenses.map(normalizeSummary) });
			})
			.catch((e) => {
				if (cancelled) return;
				const message = e instanceof ApiError ? e.message : "Não foi possível carregar as despesas.";
				setState({
					kind: "error",
					message,
					onRetry: () => {
						setState({ kind: "loading" });
						setReloadKey((k) => k + 1);
					},
				});
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId, reloadKey]);

	return <ExpenseListView groupId={groupId} state={state} />;
}
