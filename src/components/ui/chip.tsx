import { cx } from "@/lib/ui/cx";
import { Icon, type IconName } from "./icon";

/**
 * Chip de filtro M3 selecionável (alvo de toque de 48px): marca/desmarca uma opção.
 * Selecionado = contêiner secundário com um "check"; o `leading` (ex.: Avatar) vem antes do texto.
 */
export function FilterChip({
	selected,
	onToggle,
	leading,
	disabled,
	className,
	children,
}: Readonly<{
	selected: boolean;
	onToggle: () => void;
	leading?: React.ReactNode;
	disabled?: boolean;
	className?: string;
	children: React.ReactNode;
}>) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={selected}
			disabled={disabled}
			onClick={onToggle}
			className={cx(
				"state-layer inline-flex h-12 max-w-full select-none items-center gap-2 rounded-full border pl-1 pr-4 text-label-large transition-colors duration-150",
				selected
					? "border-transparent bg-secondary-container text-on-secondary-container"
					: "border-outline bg-transparent text-on-surface",
				className,
			)}
		>
			{leading}
			<span className="min-w-0 truncate">{children}</span>
			{selected && <Icon name="check" size={20} />}
		</button>
	);
}

const TONES = {
	ok: "bg-primary-container text-on-primary-container",
	wait: "bg-tertiary-container text-on-tertiary-container",
	owe: "bg-error-container text-on-error-container",
	neutral: "bg-surface-container-high text-on-surface-variant",
} as const;

/** Selo de estado (somente leitura): "Pago", "Falta pagar"... Sempre com texto, nunca só cor. */
export function StatusChip({ tone = "neutral", children }: Readonly<{ tone?: keyof typeof TONES; children: React.ReactNode }>) {
	return <span className={cx("inline-flex min-h-7 items-center rounded-full px-3 text-sm font-medium", TONES[tone])}>{children}</span>;
}

/**
 * Ação compacta no tamanho do StatusChip (28px, texto pequeno, cantos redondos), com contorno para
 * parecer tocável. A área de toque tem 48px de altura graças a uma área invisível, sem aumentar o chip.
 */
export function ActionChip({
	icon,
	tone = "outlined",
	onClick,
	disabled,
	children,
}: Readonly<{ icon?: IconName; tone?: "outlined" | "tonal"; onClick: () => void; disabled?: boolean; children: React.ReactNode }>) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cx(
				"state-layer relative inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm font-medium",
				"before:absolute before:-inset-x-1 before:-inset-y-[10px] before:content-['']",
				tone === "tonal" ? "bg-secondary-container text-on-secondary-container" : "border border-outline text-primary",
				disabled && "opacity-40",
			)}
		>
			{icon && <Icon name={icon} size={16} />}
			{children}
		</button>
	);
}
