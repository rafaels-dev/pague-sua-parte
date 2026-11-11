/** Marca do PagueSuaParte: quadrado arredondado com losangos sobrepostos (alusão ao Pix). */
export function BrandMark({ size = 40, className }: Readonly<{ size?: number; className?: string }>) {
	return (
		<svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className={className}>
			<rect width="48" height="48" rx="14" className="fill-primary" />
			<path d="M24 9.5 38.5 24 24 38.5 9.5 24Z" className="fill-none stroke-on-primary" strokeWidth="3.5" strokeLinejoin="round" />
			<path d="M24 17.5 30.5 24 24 30.5 17.5 24Z" className="fill-on-primary" />
		</svg>
	);
}

export function Wordmark({ className }: Readonly<{ className?: string }>) {
	return (
		<span className={`inline-flex items-center gap-3 ${className ?? ""}`}>
			<BrandMark />
			<span className="text-title-large font-bold text-on-surface">PagueSuaParte</span>
		</span>
	);
}
