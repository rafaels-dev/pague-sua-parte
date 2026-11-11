"use client";

import Link from "next/link";
import { GroupScopeNote } from "@/components/group-scope-note";
import { ActionChip, Avatar, Banner, Button, Card, EmptyState, Icon, Skeleton, StatusChip } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { todayISO } from "@/lib/ui/dates";
import { dueShort, installmentLabel, untilEndOfMonthLine } from "@/lib/ui/due-dates";
import { receivablesUrl } from "@/lib/ui/group-scope";
import { debtorCaption, payeeNote, type Debtor, type Receivables, type ReceivableItem } from "@/lib/ui/receivables";
import { RECURRING_CHIP } from "@/lib/ui/recurrences";

export type ReceivablesPageState =
	| { kind: "loading" }
	| { kind: "error"; message: string }
	| { kind: "unavailable" }
	| { kind: "ready"; data: Receivables };

/** O grupo a que a tela está restrita (`?grupo=`), quando há. */
export type ReceivablesScope = { id: string; name: string } | null;

/** Uma conta da lista: leva para a despesa. O que é, de que grupo (menos quando a tela é de um grupo só), vencimento, etiquetas e valor. */
function ItemRow({ item, today, showGroup = true }: Readonly<{ item: ReceivableItem; today: string; showGroup?: boolean }>) {
	const due = dueShort(item.dueDate, item.overdue, today);
	const note = payeeNote(item);
	const chips = [
		note && { tone: "wait" as const, text: note },
		item.installment && { tone: "neutral" as const, text: installmentLabel(item.installment) },
		item.recurrence && { tone: "neutral" as const, text: RECURRING_CHIP },
	].filter((c): c is { tone: "wait" | "neutral"; text: string } => !!c);
	return (
		<li>
			<Link
				href={`/app/grupos/${encodeURIComponent(item.groupId)}/despesas/${encodeURIComponent(item.expenseId)}`}
				className="state-layer flex min-h-14 items-start gap-3 py-3"
			>
				<span className="min-w-0 flex-1">
					<span className="block break-words text-body-large font-medium text-on-surface">{item.description}</span>
					{showGroup && item.groupName && <span className="block break-words text-sm text-on-surface-variant">{item.groupName}</span>}
					{due && <span className={`block text-sm ${due.overdue ? "font-medium text-error" : "text-on-surface-variant"}`}>{due.text}</span>}
					{chips.length > 0 && (
						<span className="mt-1.5 flex flex-wrap gap-1.5">
							{chips.map((c) => (
								<StatusChip key={c.text} tone={c.tone}>
									{c.text}
								</StatusChip>
							))}
						</span>
					)}
				</span>
				<span className="money shrink-0 text-title-medium text-on-surface">{formatBRL(item.dueCents)}</span>
				<Icon name="chevron_right" className="mt-0.5 shrink-0 text-on-surface-variant" />
			</Link>
		</li>
	);
}

/** Cartão de um devedor: quem é, quanto deve (e quanto já venceu), cobrar no WhatsApp e as contas. */
export function DebtorCardView({ debtor, onCollect, showGroup = true }: Readonly<{ debtor: Debtor; onCollect: () => void; showGroup?: boolean }>) {
	const today = todayISO();
	const headingId = `deve-${debtor.uid}`;
	const caption = debtorCaption(debtor);
	return (
		<Card as="section" tone="high" aria-labelledby={headingId} className="space-y-4 p-5 md:p-6">
			<div>
				<div className="flex items-center gap-3">
					<Avatar name={debtor.name} src={debtor.picture} managed={debtor.kind === "managed"} />
					<div className="min-w-0">
						<h2 id={headingId} className="break-words text-title-large">
							{debtor.name}
						</h2>
						{caption && <p className="break-words text-sm text-on-surface-variant">{caption}</p>}
					</div>
				</div>
				<p className="mt-3 text-body-large text-on-surface-variant">Deve a você</p>
				<p className="money text-headline-medium font-bold text-receive">{formatBRL(debtor.totalCents)}</p>
				{debtor.overdueCents > 0 && (
					<p className="money mt-1 flex items-center gap-1.5 text-title-medium text-error">
						<Icon name="warning" size={20} />
						{formatBRL(debtor.overdueCents)} vencido
					</p>
				)}
				{!debtor.youManage && (
					<div className="mt-3">
						<ActionChip icon="share" tone="tonal" onClick={onCollect}>
							Cobrar no WhatsApp
						</ActionChip>
					</div>
				)}
			</div>
			<ul className="divide-y divide-outline-variant/60 rounded-shape-md bg-surface-container-low px-3">
				{debtor.items.map((i) => (
					<ItemRow key={`${i.groupId}:${i.expenseId}`} item={i} today={today} showGroup={showGroup} />
				))}
			</ul>
		</Card>
	);
}

export function ReceivablesSkeleton() {
	return (
		<div role="status" className="mx-auto max-w-2xl space-y-4">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-28 rounded-shape-lg" />
			<Skeleton className="h-72 rounded-shape-lg" />
			<Skeleton className="h-56 rounded-shape-lg" />
		</div>
	);
}

/** A tela "Quem me deve": o total a receber e um cartão por devedor, ou o estado de carregando, erro ou vazio. */
export function ReceivablesView({
	state,
	onCollect,
	onRetry,
	scope = null,
}: Readonly<{ state: ReceivablesPageState; onCollect: (uid: string) => void; onRetry: () => void; scope?: ReceivablesScope }>) {
	if (state.kind === "loading") return <ReceivablesSkeleton />;
	if (state.kind === "error") {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title="Ops!"
				action={
					<>
						<Button icon="refresh" onClick={onRetry}>
							Tentar de novo
						</Button>
						<Button href="/app" variant="outlined">
							Voltar para o início
						</Button>
					</>
				}
			>
				{state.message}
			</EmptyState>
		);
	}
	if (state.kind === "unavailable") {
		return (
			<EmptyState icon="refresh" title="Ainda não está disponível" action={<Button href="/app">Voltar para o início</Button>}>
				Esta função ainda não está disponível. Tente de novo mais tarde.
			</EmptyState>
		);
	}
	const { data } = state;
	const note = scope && <GroupScopeNote groupName={scope.name} allHref={receivablesUrl()} />;
	if (data.debtors.length === 0) {
		return (
			<div className="mx-auto max-w-2xl space-y-3">
				{note}
				<EmptyState
					icon="check"
					title={scope ? "Ninguém está te devendo agora neste grupo." : "Ninguém está te devendo agora."}
					action={<Button href={scope ? `/app/grupos/${encodeURIComponent(scope.id)}` : "/app"}>{scope ? "Voltar para o grupo" : "Voltar para o início"}</Button>}
				>
					Quando alguém ficar devendo, aparece aqui.
				</EmptyState>
			</div>
		);
	}
	const until = untilEndOfMonthLine(data.totalCents, data.nowCents, todayISO());
	return (
		<div className="mx-auto max-w-2xl space-y-5">
			{note}
			<Card as="section" tone="high" aria-label="Total a receber" className="p-5 md:p-6">
				<p className="text-body-large text-on-surface-variant">Você tem a receber</p>
				<p className="money mt-1 text-display-small font-bold text-receive">{formatBRL(data.totalCents)}</p>
				{until && <p className="money mt-1 text-body-large text-on-surface-variant">{until}</p>}
				{data.managedCents > 0 && (
					<p className="money mt-1 text-body-large text-on-surface-variant">Inclui {formatBRL(data.managedCents)} para quem você cuida.</p>
				)}
			</Card>
			{data.truncated && (
				<Banner tone="attention" icon="warning">
					Tem muitas contas. Mostramos só as primeiras.
				</Banner>
			)}
			{data.debtors.map((d) => (
				<DebtorCardView key={d.uid} debtor={d} onCollect={() => onCollect(d.uid)} showGroup={!scope} />
			))}
		</div>
	);
}
