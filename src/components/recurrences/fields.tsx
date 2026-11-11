"use client";

import { useState } from "react";
import { Card, Icon, SegmentedButton, TextField } from "@/components/ui";
import { cx } from "@/lib/ui/cx";
import { todayISO } from "@/lib/ui/dates";
import {
	dayHint,
	DEFAULT_DAY,
	firstDueDate,
	firstDueLine,
	MAX_DAY,
	MIN_DAY,
	periodOf,
	recurrenceSummaryLine,
} from "@/lib/ui/recurrences";

const STEP_BUTTON =
	"state-layer flex size-14 shrink-0 select-none items-center justify-center rounded-full bg-secondary-container text-on-secondary-container disabled:opacity-40";

/** Número inteiro com botões grandes de − e + e o valor no meio, que também aceita digitação (até 2 dígitos). */
export function NumberStepper({
	id,
	label,
	value,
	min,
	max,
	fallback,
	help,
	error,
	lessLabel,
	moreLabel,
	onChange,
}: Readonly<{
	id: string;
	label: string;
	value: number;
	min: number;
	max: number;
	/** Valor quando o campo fica vazio ou inválido ao sair dele. */
	fallback: number;
	help?: React.ReactNode;
	error?: string;
	lessLabel: string;
	moreLabel: string;
	onChange: (n: number) => void;
}>) {
	// Enquanto a pessoa digita, o texto pode estar incompleto; o valor oficial só muda quando é válido.
	const [draft, setDraft] = useState<string | null>(null);
	const helpId = `${id}-ajuda`;
	const clamp = (n: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback);
	const message = error ?? help;
	return (
		<div>
			<label htmlFor={id} className="mb-2 block text-title-medium text-on-surface-variant">
				{label}
			</label>
			<div className="flex items-center gap-3">
				<button
					type="button"
					aria-label={lessLabel}
					disabled={value <= min}
					onClick={() => {
						setDraft(null);
						onChange(clamp(value - 1));
					}}
					className={STEP_BUTTON}
				>
					<Icon name="remove" size={28} />
				</button>
				<input
					id={id}
					type="text"
					inputMode="numeric"
					autoComplete="off"
					enterKeyHint="done"
					maxLength={2}
					value={draft ?? String(value)}
					aria-invalid={error ? true : undefined}
					aria-describedby={message ? helpId : undefined}
					onFocus={(e) => e.currentTarget.select()}
					onChange={(e) => {
						const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
						setDraft(digits);
						const n = Number(digits);
						if (digits && n >= min && n <= max) onChange(n);
					}}
					onBlur={() => {
						if (draft !== null && draft !== "") onChange(clamp(Number(draft)));
						setDraft(null);
					}}
					className={cx(
						"money h-14 w-0 min-w-0 flex-1 rounded-shape-sm border bg-transparent px-2 text-center text-headline-small font-bold text-on-surface outline-none transition-[border-color,box-shadow] duration-150",
						error ? "border-error" : "border-outline hover:border-on-surface focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--md-primary)]",
					)}
				/>
				<button
					type="button"
					aria-label={moreLabel}
					disabled={value >= max}
					onClick={() => {
						setDraft(null);
						onChange(clamp(value + 1));
					}}
					className={STEP_BUTTON}
				>
					<Icon name="add" size={28} />
				</button>
			</div>
			{message && (
				<p id={helpId} role={error ? "alert" : undefined} className={cx("px-1 pt-1 text-body-large", error ? "text-error" : "text-on-surface-variant")}>
					{message}
				</p>
			)}
		</div>
	);
}

/** "Todo dia": dia do mês de 1 a 31; para 29 a 31 explica o que acontece nos meses mais curtos. */
export function DayStepper({ id = "campo-dia", value, error, onChange }: Readonly<{ id?: string; value: number; error?: string; onChange: (n: number) => void }>) {
	return (
		<NumberStepper
			id={id}
			label="Todo dia"
			value={value}
			min={MIN_DAY}
			max={MAX_DAY}
			fallback={DEFAULT_DAY}
			help={dayHint(value) ?? "Dia do mês em que a despesa vence"}
			error={error}
			lessLabel="Um dia a menos"
			moreLabel="Um dia a mais"
			onChange={onChange}
		/>
	);
}

const END_OPTIONS = [
	{ value: "never", label: "Sem data para acabar" },
	{ value: "month", label: "Até um mês" },
] as const;

/**
 * "Até quando?": sem data para acabar ou um mês final.
 * `value`: null = sem fim; "" = escolheu "Até um mês" mas ainda não marcou o mês; "2027-03" = mês final.
 */
export function EndPeriodField({
	id = "campo-ate",
	value,
	min,
	error,
	onChange,
}: Readonly<{ id?: string; value: string | null; min?: string; error?: string; onChange: (v: string | null) => void }>) {
	return (
		<div className="space-y-3">
			<p className="text-title-medium text-on-surface-variant">Até quando?</p>
			<SegmentedButton label="Até quando?" value={value === null ? "never" : "month"} options={END_OPTIONS} onChange={(v) => onChange(v === "never" ? null : (value ?? ""))} />
			{value !== null && (
				<TextField
					id={id}
					type="month"
					floatLabel
					label="Último mês"
					value={value}
					min={min}
					onChange={(e) => onChange(e.target.value)}
					error={error}
					supportingText="A última despesa será neste mês"
				/>
			)}
		</div>
	);
}

/** Conta ao vivo: "Todo dia 25, R$ 300,00" e quando vence a primeira. */
export function MonthlySummary({ amountCents, day, today = todayISO() }: Readonly<{ amountCents: number; day: number; today?: string }>) {
	const first = firstDueDate(today, day);
	return (
		<Card tone="high" className="space-y-1 p-4" aria-live="polite">
			{amountCents > 0 ? (
				<p className="money text-title-large">{recurrenceSummaryLine(day, amountCents)}</p>
			) : (
				<p className="text-body-large text-on-surface-variant">Digite o valor de cada mês, lá em cima.</p>
			)}
			{first && <p className="text-body-large text-on-surface-variant">{firstDueLine(first, today)}</p>}
		</Card>
	);
}

/** Primeiro mês possível para o fim (o da primeira despesa), no formato do campo de mês. */
export function firstMonthOf(day: number, today: string = todayISO()): string {
	return periodOf(firstDueDate(today, day));
}
