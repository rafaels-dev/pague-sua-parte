"use client";

import { useId } from "react";
import { cx } from "@/lib/ui/cx";
import { centsFromTyped, maskedMoney } from "@/lib/ui/money-mask";

/**
 * Campo de valor grande, com máscara de dinheiro: digitar "1234" mostra "R$ 12,34".
 * Controlado em centavos inteiros.
 */
export function MoneyField({
	label,
	cents,
	onChange,
	error,
	autoFocus,
	id,
	className,
	placeholder = "R$ 0,00",
	supportingText,
}: Readonly<{
	label: string;
	cents: number;
	onChange: (cents: number) => void;
	error?: string | null;
	autoFocus?: boolean;
	id?: string;
	className?: string;
	/** Dica em cinza quando o campo está vazio (não é valor preenchido). */
	placeholder?: string;
	/** Texto de apoio abaixo do campo (sem erro). */
	supportingText?: React.ReactNode;
}>) {
	const auto = useId();
	const fieldId = id ?? auto;
	const helpId = `${fieldId}-erro`;
	return (
		<div className={className}>
			<label htmlFor={fieldId} className="mb-2 block text-title-medium text-on-surface-variant">
				{label}
			</label>
			<input
				id={fieldId}
				type="text"
				inputMode="numeric"
				autoComplete="off"
				autoFocus={autoFocus}
				placeholder={placeholder}
				value={maskedMoney(cents)}
				onChange={(e) => onChange(centsFromTyped(e.target.value))}
				aria-invalid={error ? true : undefined}
				aria-describedby={error || supportingText ? helpId : undefined}
				className={cx(
					"money h-20 w-full rounded-shape-md border bg-transparent px-5 text-display-small font-bold text-on-surface outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-on-surface-variant/60",
					error
						? "border-error shadow-[inset_0_0_0_1px_var(--md-error)]"
						: "border-outline hover:border-on-surface focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--md-primary)]",
				)}
			/>
			{error ? (
				<p id={helpId} role="alert" className="px-1 pt-1 text-body-large text-error">
					{error}
				</p>
			) : (
				supportingText && (
					<p id={helpId} className="px-1 pt-1 text-body-large text-on-surface-variant">
						{supportingText}
					</p>
				)
			)}
		</div>
	);
}
