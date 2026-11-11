import { cx } from "@/lib/ui/cx";

const TONES = {
	// --field-bg: cor de fundo que o rótulo flutuante dos campos de texto deve imitar.
	low: "bg-surface-container-low [--field-bg:var(--md-surface-container-low)]",
	default: "bg-surface-container [--field-bg:var(--md-surface-container)]",
	high: "bg-surface-container-high [--field-bg:var(--md-surface-container-high)]",
} as const;

/** Cartão M3: "filled" (superfície tonal) ou "outlined" (contorno, sem sombra). */
export function Card({
	variant = "filled",
	tone = "low",
	shape = "lg",
	as: Tag = "div",
	className,
	children,
	...rest
}: Readonly<
	{
		variant?: "filled" | "outlined";
		tone?: keyof typeof TONES;
		shape?: "md" | "lg";
		as?: "div" | "section" | "article" | "ul";
		className?: string;
		children: React.ReactNode;
	} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">
>) {
	return (
		<Tag
			className={cx(
				shape === "lg" ? "rounded-shape-lg" : "rounded-shape-md",
				variant === "filled" ? TONES[tone] : "border border-outline-variant bg-surface",
				className,
			)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
