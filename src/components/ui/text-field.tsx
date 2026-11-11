import { useId } from "react";
import { cx } from "@/lib/ui/cx";
import { Icon } from "./icon";

/** Campo de texto M3 "outlined": rótulo flutuante, texto de apoio e estado de erro. */
export function TextField({
	label,
	supportingText,
	error,
	className,
	id,
	floatLabel = false,
	...input
}: Readonly<
	{
		label: string;
		supportingText?: React.ReactNode;
		/** Mensagem de erro; quando presente o campo fica em estado de erro. */
		error?: string | null;
		/** Rótulo sempre no alto do campo (campos de data, que nunca ficam "vazios" para o navegador). */
		floatLabel?: boolean;
		className?: string;
	} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "className">
>) {
	const auto = useId();
	const fieldId = id ?? auto;
	const helpId = `${fieldId}-help`;
	const hasError = !!error;
	const help = error ?? supportingText;

	return (
		<div className={className}>
			<div className="relative">
				<input
					id={fieldId}
					placeholder=" "
					aria-invalid={hasError || undefined}
					aria-describedby={help ? helpId : undefined}
					{...input}
					className={cx(
						"peer h-14 w-full rounded-shape-sm border bg-transparent px-4 text-body-large text-on-surface outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-transparent focus:placeholder:text-on-surface-variant ",
						hasError
							? "border-error pr-12 shadow-[inset_0_0_0_1px_var(--md-error)]"
							: "border-outline hover:border-on-surface focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--md-primary)]",
					)}
				/>
				<label
					htmlFor={fieldId}
					className={cx(
						"pointer-events-none absolute left-3 top-4 origin-left bg-(--field-bg,var(--md-surface)) px-1 text-body-large transition-all duration-150 ease-out",
						"peer-focus:-top-2.5 peer-focus:text-sm peer-focus:font-medium peer-not-placeholder-shown:-top-2.5 peer-not-placeholder-shown:text-sm peer-not-placeholder-shown:font-medium",
						floatLabel && "-top-2.5 text-sm font-medium",
						hasError ? "text-error" : "text-on-surface-variant peer-focus:text-primary",
					)}
				>
					{label}
				</label>
				{hasError && <Icon name="error" className="pointer-events-none absolute right-3 top-4 text-error" />}
			</div>
			{help && (
				<p
					id={helpId}
					role={hasError ? "alert" : undefined}
					className={cx("px-4 pt-1 text-body-large", hasError ? "text-error" : "text-on-surface-variant")}
				>
					{help}
				</p>
			)}
		</div>
	);
}
