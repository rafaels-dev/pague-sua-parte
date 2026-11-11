import { cx } from "@/lib/ui/cx";

/** Indicador de progresso circular M3 (indeterminado). O texto fica só para leitores de tela. */
export function CircularProgress({
	size = 48,
	label = "Carregando...",
	className,
}: Readonly<{ size?: number; label?: string; className?: string }>) {
	return (
		<span role="status" className={cx("inline-flex", className)}>
			<svg
				viewBox="0 0 48 48"
				width={size}
				height={size}
				aria-hidden="true"
				className="[animation:md-spin_1.4s_linear_infinite]"
			>
				<circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="5" />
				<circle
					cx="24"
					cy="24"
					r="18"
					fill="none"
					stroke="currentColor"
					strokeWidth="5"
					strokeLinecap="round"
					strokeDasharray="70 200"
				/>
			</svg>
			<span className="sr-only">{label}</span>
		</span>
	);
}

/** Bloco-esqueleto para estados de carregamento. */
export function Skeleton({ className }: Readonly<{ className?: string }>) {
	return (
		<div aria-hidden="true" className={cx("rounded-shape-sm bg-surface-container-high [animation:md-pulse_1.6s_ease-in-out_infinite]", className)} />
	);
}
