import { cx } from "@/lib/ui/cx";
import type { AmbiguousKeyChoice } from "@/lib/pix/key";

const OPTIONS: { value: AmbiguousKeyChoice; label: string }[] = [
	{ value: "cpf", label: "CPF" },
	{ value: "phone", label: "Celular" },
];

/** Aparece só quando o número digitado pode ser CPF ou celular: a pessoa escolhe qual é. */
export function PixKeyChoice({ value, onChange }: Readonly<{ value: AmbiguousKeyChoice | null; onChange: (v: AmbiguousKeyChoice) => void }>) {
	return (
		<div role="radiogroup" aria-label="Essa chave é CPF ou celular?" className="space-y-2">
			<p className="text-title-medium">Essa chave é CPF ou celular?</p>
			<div className="grid grid-cols-2 gap-3">
				{OPTIONS.map((o) => (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={value === o.value}
						onClick={() => onChange(o.value)}
						className={cx(
							"state-layer min-h-14 rounded-shape-md border px-3 text-body-large font-medium",
							value === o.value ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline text-on-surface",
						)}
					>
						{o.label}
					</button>
				))}
			</div>
		</div>
	);
}
