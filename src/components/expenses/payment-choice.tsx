"use client";

import { Card, SegmentedButton, TextField } from "@/components/ui";
import { DayStepper, EndPeriodField, firstMonthOf, MonthlySummary, NumberStepper } from "@/components/recurrences/fields";
import {
	dueMonthsShort,
	installmentSchedule,
	installmentTotalLine,
	MAX_INSTALLMENTS,
	MIN_INSTALLMENTS,
} from "@/lib/ui/due-dates";

/** Como a compra foi paga: à vista em dinheiro, cartão (pede a data da próxima fatura) ou Pix; parcelado (uma despesa por mês); ou "todo mês" (despesa fixa que o servidor lança sozinho a cada mês). */
export type PaymentKind = "cash" | "card" | "pix" | "installments" | "monthly";

const MODES = [
	{ value: "once", label: "À vista" },
	{ value: "installments", label: "Parcelado" },
	{ value: "monthly", label: "Todo mês" },
] as const;

const METHODS = [
	{ value: "cash", label: "Dinheiro" },
	{ value: "card", label: "Cartão" },
	{ value: "pix", label: "Pix" },
] as const;

/** Campo de data no estilo do TextField: a pessoa informa o dia. */
function DueDateField({
	id,
	label,
	helper,
	value,
	min,
	error,
	onChange,
}: Readonly<{ id: string; label: string; helper: string; value: string; min: string; error?: string; onChange: (v: string) => void }>) {
	return <TextField id={id} type="date" floatLabel label={label} value={value} min={min} onChange={(e) => onChange(e.target.value)} error={error} supportingText={helper} />;
}

/** "Quantas parcelas?": botões grandes de − e + e o número no meio, que também aceita digitação. */
export function InstallmentStepper({ id = "campo-parcelas", value, error, onChange }: Readonly<{ id?: string; value: number; error?: string; onChange: (n: number) => void }>) {
	return (
		<NumberStepper
			id={id}
			label="Quantas parcelas?"
			value={value}
			min={MIN_INSTALLMENTS}
			max={MAX_INSTALLMENTS}
			fallback={MIN_INSTALLMENTS}
			help={`De ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas, uma por mês`}
			error={error}
			lessLabel="Menos uma parcela"
			moreLabel="Mais uma parcela"
			onChange={onChange}
		/>
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

/** "Como foi pago?": à vista (com a forma de pagamento; no cartão, pede a data da próxima fatura) ou parcelado (pede parcelas e o primeiro vencimento). */
export function PaymentChoice({
	payment,
	onPayment,
	dueDate,
	onDueDate,
	installments,
	onInstallments,
	amountCents,
	purchaseDate,
	dayOfMonth,
	onDayOfMonth,
	endPeriod,
	onEndPeriod,
	errors,
}: Readonly<{
	payment: PaymentKind;
	onPayment: (p: PaymentKind) => void;
	dueDate: string;
	onDueDate: (v: string) => void;
	installments: number;
	onInstallments: (n: number) => void;
	amountCents: number;
	/** Dia da compra: a fatura ou a primeira parcela não podem vencer antes dele. */
	purchaseDate: string;
	/** Despesa fixa: dia do mês (1 a 31). */
	dayOfMonth: number;
	onDayOfMonth: (n: number) => void;
	/** Despesa fixa: null = sem fim; "" = quer escolher o mês e ainda não escolheu; "2027-03" = mês final. */
	endPeriod: string | null;
	onEndPeriod: (v: string | null) => void;
	errors: { dueDate?: string; installments?: string; dayOfMonth?: string; endPeriod?: string };
}>) {
	return (
		<fieldset className="min-w-0 space-y-3">
			<legend className="mb-2 text-title-medium text-on-surface-variant">{payment === "monthly" ? "Como é pago?" : "Como foi pago?"}</legend>
			<SegmentedButton
				label="Como foi pago?"
				value={payment === "installments" || payment === "monthly" ? payment : "once"}
				options={MODES}
				onChange={(m) => {
					if (m === "installments" || m === "monthly") onPayment(m);
					else if (payment === "installments" || payment === "monthly") onPayment("cash");
				}}
			/>
			{payment !== "installments" && payment !== "monthly" && (
				<div className="space-y-3 pt-1">
					<p className="text-title-medium text-on-surface-variant">Forma de pagamento</p>
					<SegmentedButton label="Forma de pagamento" value={payment} options={METHODS} onChange={onPayment} />
					{payment === "card" && (
						<DueDateField
							id="campo-vencimento"
							label="Data da próxima fatura"
							helper="Dia em que a fatura do cartão vence"
							value={dueDate}
							min={purchaseDate}
							error={errors.dueDate}
							onChange={onDueDate}
						/>
					)}
				</div>
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
						error={errors.dueDate}
						onChange={onDueDate}
					/>
					<InstallmentSummary amountCents={amountCents} count={installments} firstDue={dueDate} />
				</div>
			)}
			{payment === "monthly" && (
				<div className="space-y-5 pt-1">
					<DayStepper value={dayOfMonth} error={errors.dayOfMonth} onChange={onDayOfMonth} />
					<MonthlySummary amountCents={amountCents} day={dayOfMonth} />
					<EndPeriodField value={endPeriod} min={firstMonthOf(dayOfMonth)} error={errors.endPeriod} onChange={onEndPeriod} />
				</div>
			)}
		</fieldset>
	);
}
