"use client";

import { useState } from "react";
import { Card, FilterChip, Icon, SegmentedButton, TextField } from "@/components/ui";
import { cx } from "@/lib/ui/cx";
import {
	clampInstallments,
	dueMonthsShort,
	installmentSchedule,
	installmentTotalLine,
	MAX_INSTALLMENTS,
	MIN_INSTALLMENTS,
	nextDayOfMonth,
	nextMonthSameDay,
} from "@/lib/ui/due-dates";

/** Como a compra foi paga: à vista (sem data), no cartão (vence numa data) ou parcelado (uma despesa por mês). */
export type PaymentKind = "cash" | "card" | "installments";

const OPTIONS = [
	{ value: "cash", label: "À vista" },
	{ value: "card", label: "No cartão" },
	{ value: "installments", label: "Parcelado" },
] as const;

/** Campo de data no estilo do TextField, com atalhos opcionais ("Dia 10", "Dia 15", "Mês que vem"). */
function DueDateField({
	id,
	label,
	helper,
	value,
	min,
	today,
	error,
	onChange,
}: Readonly<{ id: string; label: string; helper: string; value: string; min: string; today: string; error?: string; onChange: (v: string) => void }>) {
	const shortcuts = [
		{ label: "Dia 10", date: nextDayOfMonth(today, 10) },
		{ label: "Dia 15", date: nextDayOfMonth(today, 15) },
		{ label: "Mês que vem", date: nextMonthSameDay(today) },
	];
	return (
		<div className="space-y-2">
			<TextField id={id} type="date" floatLabel label={label} value={value} min={min} onChange={(e) => onChange(e.target.value)} error={error} supportingText={helper} />
			<div role="group" aria-label="Atalhos de data" className="flex flex-wrap gap-2">
				{shortcuts.map((s) => (
					<FilterChip key={s.label} selected={value === s.date} onToggle={() => onChange(s.date)} leading={<span className="w-2" />}>
						{s.label}
					</FilterChip>
				))}
			</div>
		</div>
	);
}

const STEP_BUTTON =
	"state-layer flex size-14 shrink-0 select-none items-center justify-center rounded-full bg-secondary-container text-on-secondary-container disabled:opacity-40";

/** "Quantas parcelas?": botões grandes de − e + e o número no meio, que também aceita digitação. */
export function InstallmentStepper({ id = "campo-parcelas", value, error, onChange }: Readonly<{ id?: string; value: number; error?: string; onChange: (n: number) => void }>) {
	// Enquanto a pessoa digita, o texto pode estar incompleto ("" ou "1"); o valor oficial só muda quando é válido.
	const [draft, setDraft] = useState<string | null>(null);
	const helpId = `${id}-ajuda`;
	return (
		<div>
			<label htmlFor={id} className="mb-2 block text-title-medium text-on-surface-variant">
				Quantas parcelas?
			</label>
			<div className="flex items-center gap-3">
				<button
					type="button"
					aria-label="Menos uma parcela"
					disabled={value <= MIN_INSTALLMENTS}
					onClick={() => {
						setDraft(null);
						onChange(clampInstallments(value - 1));
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
					aria-describedby={error ? helpId : undefined}
					onFocus={(e) => e.currentTarget.select()}
					onChange={(e) => {
						const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
						setDraft(digits);
						const n = Number(digits);
						if (digits && n >= MIN_INSTALLMENTS && n <= MAX_INSTALLMENTS) onChange(n);
					}}
					onBlur={() => {
						if (draft !== null && draft !== "") onChange(clampInstallments(Number(draft)));
						setDraft(null);
					}}
					className={cx(
						"money h-14 w-0 min-w-0 flex-1 rounded-shape-sm border bg-transparent px-2 text-center text-headline-small font-bold text-on-surface outline-none transition-[border-color,box-shadow] duration-150",
						error ? "border-error" : "border-outline hover:border-on-surface focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--md-primary)]",
					)}
				/>
				<button
					type="button"
					aria-label="Mais uma parcela"
					disabled={value >= MAX_INSTALLMENTS}
					onClick={() => {
						setDraft(null);
						onChange(clampInstallments(value + 1));
					}}
					className={STEP_BUTTON}
				>
					<Icon name="add" size={28} />
				</button>
			</div>
			<p id={helpId} role={error ? "alert" : undefined} className={cx("px-1 pt-1 text-body-large", error ? "text-error" : "text-on-surface-variant")}>
				{error ?? `De ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas, uma por mês`}
			</p>
		</div>
	);
}

/** Conta ao vivo de uma compra parcelada: "6 × R$ 120,00 = R$ 720,00" e os meses dos vencimentos. */
export function InstallmentSummary({ amountCents, count, firstDue }: Readonly<{ amountCents: number; count: number; firstDue: string }>) {
	const months = dueMonthsShort(installmentSchedule(firstDue, count));
	return (
		<Card tone="high" className="space-y-1 p-4" aria-live="polite">
			{amountCents > 0 ? (
				<p className="money text-title-large">{installmentTotalLine(count, amountCents)}</p>
			) : (
				<p className="text-body-large text-on-surface-variant">Digite o valor de cada parcela, lá em cima.</p>
			)}
			{months ? (
				<p className="text-body-large text-on-surface-variant">Vence em: {months}</p>
			) : (
				<p className="text-body-large text-on-surface-variant">Escolha quando vence a primeira parcela.</p>
			)}
		</Card>
	);
}

/** "Como foi pago?": à vista (nada a mais), no cartão (pede o vencimento) ou parcelado (pede parcelas e o primeiro vencimento). */
export function PaymentChoice({
	payment,
	onPayment,
	dueDate,
	onDueDate,
	installments,
	onInstallments,
	amountCents,
	purchaseDate,
	today,
	errors,
}: Readonly<{
	payment: PaymentKind;
	onPayment: (p: PaymentKind) => void;
	dueDate: string;
	onDueDate: (v: string) => void;
	installments: number;
	onInstallments: (n: number) => void;
	amountCents: number;
	/** Dia da compra: o vencimento não pode ser antes dele. */
	purchaseDate: string;
	today: string;
	errors: { dueDate?: string; installments?: string };
}>) {
	return (
		<fieldset className="min-w-0 space-y-3">
			<legend className="mb-2 text-title-medium text-on-surface-variant">Como foi pago?</legend>
			<SegmentedButton label="Como foi pago?" value={payment} options={OPTIONS} onChange={onPayment} />
			{payment === "card" && (
				<DueDateField
					id="campo-vencimento"
					label="Vence em"
					helper="Dia do vencimento da fatura"
					value={dueDate}
					min={purchaseDate}
					today={today}
					error={errors.dueDate}
					onChange={onDueDate}
				/>
			)}
			{payment === "installments" && (
				<div className="space-y-5 pt-1">
					<InstallmentStepper value={installments} error={errors.installments} onChange={onInstallments} />
					<DueDateField
						id="campo-vencimento"
						label="Primeira parcela vence em"
						helper="As outras vencem no mesmo dia"
						value={dueDate}
						min={purchaseDate}
						today={today}
						error={errors.dueDate}
						onChange={onDueDate}
					/>
					<InstallmentSummary amountCents={amountCents} count={installments} firstDue={dueDate} />
				</div>
			)}
		</fieldset>
	);
}
