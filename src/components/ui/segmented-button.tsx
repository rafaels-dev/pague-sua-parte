import { cx } from "@/lib/ui/cx";

/**
 * Botão segmentado M3 de escolha única (alvo de toque de 48px). A opção marcada ganha contêiner
 * secundário e um "check"; use poucas opções, com rótulos curtos.
 */
export function SegmentedButton<T extends string>({
	label,
	value,
	options,
	onChange,
	className,
}: Readonly<{
	/** Nome do grupo de opções, lido por leitores de tela. */
	label: string;
	value: T;
	options: readonly { value: T; label: string }[];
	onChange: (value: T) => void;
	className?: string;
}>) {
	return (
		<div role="radiogroup" aria-label={label} className={cx("flex h-12 w-full overflow-hidden rounded-full border border-outline", className)}>
			{options.map((o, i) => {
				const selected = o.value === value;
				return (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={selected}
						onClick={() => onChange(o.value)}
						className={cx(
							"state-layer flex min-w-0 flex-1 select-none items-center justify-center gap-1.5 px-2 text-label-large transition-colors duration-150",
							i > 0 && "border-l border-outline",
							selected ? "bg-secondary-container text-on-secondary-container" : "bg-transparent text-on-surface",
						)}
					>
						<span className="line-clamp-2 break-words text-center leading-tight">{o.label}</span>
					</button>
				);
			})}
		</div>
	);
}
