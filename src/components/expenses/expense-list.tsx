"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button, EmptyState, Fab, Icon, List, ListItem, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatDateShort, todayISO } from "@/lib/ui/dates";
import { dueShort, installmentShort } from "@/lib/ui/due-dates";
import { listStatus, paidByLabel } from "@/lib/ui/expense-status";
import { managedLines, ownerViewStatus } from "@/lib/ui/managed";
import { cx } from "@/lib/ui/cx";
import { normalizeSummary, type ExpenseSummary } from "./types";

export type ExpenseListState =
	| { kind: "loading" }
	| { kind: "error"; message: string; onRetry: () => void }
	| { kind: "ready"; expenses: ExpenseSummary[] };

const STATUS_COLOR = { owe: "text-error", wait: "text-on-surface-variant", ok: "text-receive" } as const;

/** Linha de uma despesa na lista: descrição, quem pagou, vencimento/parcela e a situação da pessoa. */
function ExpenseRow({ groupId, e, today }: Readonly<{ groupId: string; e: ExpenseSummary; today: string }>) {
	const status = listStatus(e);
	const extra = [...(e.ownerView ? [ownerViewStatus(e.paidBy.name, e.ownerView)] : []), ...managedLines(e.managed)];
	const due = dueShort(e.dueDate, e.overdue, today);
	const dueParts = [e.installment ? installmentShort(e.installment) : null, due?.text ?? null].filter((x): x is string => !!x);
	return (
		<ListItem
			href={`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(e.id)}`}
			leading={
				<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
					<Icon name={e.installment ? "calendar_today" : "receipt_long"} />
				</span>
			}
			headline={e.description}
			supporting={
				<>
					<span className="block text-on-surface-variant">
						{paidByLabel({ name: e.paidBy.name, isYou: e.paidBy.isYou })} · {formatDateShort(e.date)}
					</span>
					{dueParts.length > 0 && (
						<span className={cx("block text-sm", due?.overdue ? "font-medium text-error" : "text-on-surface-variant")}>
							{dueParts.map((t, i) => (
								<span key={t}>
									{i > 0 && " · "}
									<span className="whitespace-nowrap">{t}</span>
								</span>
							))}
						</span>
					)}
					{e.canHelp && (
						<span className="block font-medium text-primary">
							{e.ownerAlone ? `${e.paidBy.name} pagou sozinho(a) · Quero ajudar` : "Dá para ajudar a dividir · Quero ajudar"}
						</span>
					)}
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
}

/** Quantas despesas esperam a sua ajuda. */
export const helpCount = (expenses: ExpenseSummary[]): number => expenses.filter((e) => e.canHelp).length;

/** Quitadas acima disto começam recolhidas. */
export const SETTLED_COLLAPSE_AFTER = 5;

/** As despesas em duas partes, na ordem que o servidor mandou: "Em aberto" e "Quitadas" (recolhidas quando são muitas). */
export function ExpenseGroups({ groupId, expenses }: Readonly<{ groupId: string; expenses: ExpenseSummary[] }>) {
	const today = todayISO();
	const open = expenses.filter((e) => !e.settled);
	const settled = expenses.filter((e) => e.settled);
	const long = settled.length > SETTLED_COLLAPSE_AFTER;
	const [expanded, setExpanded] = useState(false);
	const showSettled = !long || expanded;
	return (
		<div className="space-y-6">
			{open.length > 0 && (
				<section className="space-y-2" aria-labelledby="despesas-em-aberto">
					<h3 id="despesas-em-aberto" className="text-title-medium text-on-surface-variant">
						Em aberto
					</h3>
					<List>
						{open.map((e) => (
							<ExpenseRow key={e.id} groupId={groupId} e={e} today={today} />
						))}
					</List>
				</section>
			)}
			{settled.length > 0 && (
				<section className="space-y-2" aria-labelledby="despesas-quitadas">
					{long ? (
						<h3 id="despesas-quitadas">
							<button
								type="button"
								aria-expanded={expanded}
								aria-controls="despesas-quitadas-lista"
								onClick={() => setExpanded((x) => !x)}
								className="state-layer -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-full px-2 text-left text-title-medium text-on-surface-variant"
							>
								<span>Quitadas ({settled.length})</span>
								<span className="flex items-center gap-1 text-label-large text-primary">
									{expanded ? "Esconder" : "Mostrar"}
									<Icon name={expanded ? "expand_less" : "expand_more"} />
								</span>
							</button>
						</h3>
					) : (
						<h3 id="despesas-quitadas" className="text-title-medium text-on-surface-variant">
							Quitadas
						</h3>
					)}
					{showSettled && (
						<div id="despesas-quitadas-lista">
							<List>
								{settled.map((e) => (
									<ExpenseRow key={e.id} groupId={groupId} e={e} today={today} />
								))}
							</List>
						</div>
					)}
				</section>
			)}
		</div>
	);
}

/** Faixa "N despesas esperando ajuda": mostra só essas ou volta a mostrar todas. */
export function HelpBanner({ count, active, onToggle }: Readonly<{ count: number; active: boolean; onToggle: () => void }>) {
	return (
		<section id="esperando-ajuda" aria-label="Despesas esperando ajuda" className="flex flex-col gap-3 rounded-shape-md bg-primary-container p-4 text-on-primary-container sm:flex-row sm:items-center">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<Icon name="favorite" className="shrink-0" />
				<p className="min-w-0 flex-1 text-title-medium">{count === 1 ? "1 despesa esperando ajuda" : `${count} despesas esperando ajuda`}</p>
			</div>
			<Button variant="tonal" size="md" onClick={onToggle} aria-pressed={active} className="bg-surface! text-primary!">
				{active ? "Ver todas" : "Ver só essas"}
			</Button>
		</section>
	);
}

/** Seção "Despesas" da tela do grupo: lista, estado vazio e a ação "Lançar despesa" (botão em telas largas, FAB no celular). */
export function ExpenseListView({ groupId, state, initialHelpOnly = false }: Readonly<{ groupId: string; state: ExpenseListState; initialHelpOnly?: boolean }>) {
	const [helpOnly, setHelpOnly] = useState(initialHelpOnly);
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
					{helpCount(state.expenses) > 0 && (
						<HelpBanner
							count={helpCount(state.expenses)}
							active={helpOnly}
							onToggle={() => {
								setHelpOnly((x) => !x);
								document.getElementById("esperando-ajuda")?.scrollIntoView({ block: "start", behavior: "smooth" });
							}}
						/>
					)}
					<ExpenseGroups groupId={groupId} expenses={helpOnly && helpCount(state.expenses) > 0 ? state.expenses.filter((e) => e.canHelp) : state.expenses} />
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

	// Vindo do relatório (?ajuda=1): já mostra só as despesas esperando ajuda.
	const [fromReport] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ajuda") === "1");
	return <ExpenseListView groupId={groupId} state={state} initialHelpOnly={fromReport} />;
}
