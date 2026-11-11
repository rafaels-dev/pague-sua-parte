"use client";

import { ActionChip, Avatar, Banner, Button, Icon, List, ListItem, MoneyField, Skeleton, TextField } from "@/components/ui";
import { endLine, nextDueLine, payerLine, recurrenceLine } from "@/lib/ui/recurrences";
import { todayISO } from "@/lib/ui/dates";
import { DayStepper, EndPeriodField } from "./fields";
import type { Recurrence } from "./types";

export type RecurrencesState = { kind: "loading" } | { kind: "ready"; items: Recurrence[] } | { kind: "unavailable" };

/**
 * Linha recolhida "Despesas fixas (N)" da tela do grupo, no mesmo estilo de "Pessoas do grupo".
 * Some quando não há nenhuma (ou quando o servidor ainda não tem o recurso).
 */
export function RecurrencesDetails({
	state,
	onOptions,
	today = todayISO(),
	defaultOpen = false,
}: Readonly<{ state: RecurrencesState; onOptions?: (r: Recurrence) => void; today?: string; defaultOpen?: boolean }>) {
	if (state.kind === "unavailable") return null;
	if (state.kind === "loading") return <Skeleton className="h-14 rounded-shape-md" />;
	if (state.items.length === 0) return null;
	return (
		<details open={defaultOpen} className="group rounded-shape-md bg-surface-container-low">
			<summary className="state-layer flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-shape-md px-4 text-title-medium [&::-webkit-details-marker]:hidden">
				<Icon name="calendar_today" className="text-on-surface-variant" />
				<span className="flex-1">
					Despesas fixas <span className="font-normal text-on-surface-variant">({state.items.length})</span>
				</span>
				<Icon name="expand_more" className="text-on-surface-variant transition-transform group-open:rotate-180" />
			</summary>
			<div className="px-2 pb-3 pt-1">
				<List>
					{state.items.map((r) => {
						const end = endLine(r.endPeriod);
						const next = nextDueLine(r.nextDueDate, today);
						return (
							<ListItem
								key={r.id}
								leading={<Avatar name={r.paidBy.name || "?"} src={r.paidBy.picture} managed={r.paidBy.kind === "managed"} />}
								headline={r.description}
								supporting={
									<>
										<span className="money block">{recurrenceLine(r)}</span>
										<span className="block text-sm">{payerLine(r.paidBy)}</span>
										{next && <span className="block text-sm">{next}</span>}
										{end && <span className="block text-sm">{end}</span>}
									</>
								}
								trailing={
									r.canEdit && onOptions ? (
										<ActionChip icon="more_vert" onClick={() => onOptions(r)}>
											Opções
										</ActionChip>
									) : undefined
								}
							/>
						);
					})}
				</List>
			</div>
		</details>
	);
}

export type RecurrenceFormErrors = Partial<Record<"description" | "amount" | "dayOfMonth" | "endPeriod" | "form", string>>;

/** Primeira tela do sheet de uma despesa fixa: o que dá para fazer. */
export function RecurrenceOptionsContent({
	recurrence,
	onEdit,
	onEnd,
}: Readonly<{ recurrence: Recurrence; onEdit: () => void; onEnd: () => void }>) {
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">{recurrenceLine(recurrence)}</p>
			<div className="flex flex-col gap-3">
				<Button variant="tonal" icon="description" onClick={onEdit} fullWidth>
					Mudar valor, dia ou nome
				</Button>
				<Button variant="text" icon="close" onClick={onEnd} fullWidth className="text-error!">
					Encerrar despesa fixa
				</Button>
			</div>
		</div>
	);
}

/** Formulário simples para mudar descrição, valor, dia e "até quando". Vale só para os próximos meses. */
export function RecurrenceEditContent({
	description,
	amountCents,
	dayOfMonth,
	endPeriod,
	minEnd,
	errors,
	busy,
	onDescription,
	onAmount,
	onDay,
	onEndPeriod,
	onSubmit,
	onCancel,
}: Readonly<{
	description: string;
	amountCents: number;
	dayOfMonth: number;
	endPeriod: string | null;
	minEnd?: string;
	errors: RecurrenceFormErrors;
	busy: boolean;
	onDescription: (v: string) => void;
	onAmount: (c: number) => void;
	onDay: (n: number) => void;
	onEndPeriod: (v: string | null) => void;
	onSubmit: () => void;
	onCancel: () => void;
}>) {
	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
			className="space-y-5"
		>
			<TextField id="rec-descricao" label="O que é?" value={description} onChange={(e) => onDescription(e.target.value)} maxLength={80} autoComplete="off" error={errors.description} />
			<MoneyField id="rec-valor" label="Valor de cada mês" cents={amountCents} onChange={onAmount} error={errors.amount} />
			<DayStepper id="rec-dia" value={dayOfMonth} error={errors.dayOfMonth} onChange={onDay} />
			<EndPeriodField id="rec-ate" value={endPeriod} min={minEnd} error={errors.endPeriod} onChange={onEndPeriod} />
			<p className="text-body-large text-on-surface-variant">Vale para os próximos meses. O que já foi lançado não muda.</p>
			{errors.form && (
				<Banner tone="error" icon="error" role="alert">
					{errors.form}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button type="submit" fullWidth loading={busy} icon={busy ? undefined : "check"}>
					{busy ? "Salvando..." : "Salvar"}
				</Button>
				<Button variant="outlined" fullWidth disabled={busy} onClick={onCancel}>
					Cancelar
				</Button>
			</div>
		</form>
	);
}

/** Pergunta antes de encerrar: os meses já lançados ficam e nenhum novo será criado. */
export function RecurrenceEndContent({
	recurrence,
	busy,
	error,
	onConfirm,
	onCancel,
}: Readonly<{ recurrence: Pick<Recurrence, "description">; busy: boolean; error: string | null; onConfirm: () => void; onCancel: () => void }>) {
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface">
				Encerrar a despesa fixa “{recurrence.description}”? As despesas dos meses que já foram lançadas continuam no grupo. Mas nenhum mês novo será criado.
			</p>
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button onClick={onConfirm} loading={busy} fullWidth className="bg-error! text-on-error!">
					{busy ? "Encerrando..." : "Sim, encerrar"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Voltar
				</Button>
			</div>
		</div>
	);
}
