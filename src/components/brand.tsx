/**
 * Marca do PagueSuaParte: uma mãozinha aberta, com a palma para cima, recebendo uma moeda.
 * Desenho original do projeto.
 */

const HAND =
	"M18.5 39H28c2.6 0 4.9.8 7.2 2.2l4.3 2.6c.5.3 1 .4 1.6.4h5.2c1.9 0 3.2 1.3 3.2 2.9l6.3-4.9c1.3-1 3.1-.8 4.1.5 1 1.3.8 3.1-.5 4.1l-10.3 7.9c-1.6 1.2-3.5 1.800-5.500 1.800H18.5z";
const THUMB = "M33 48.5h10.3c1.3 0 2.3-.7 2.700-1.700";
const CIFRAO =
	"M40.4 17.6c-.8-1.200-2-1.800-3.400-1.800-1.900 0-3.200 1-3.200 2.500 0 3.300 6.900 1.600 6.900 5 0 1.600-1.400 2.600-3.500 2.600-1.600 0-2.900-.7-3.700-2M37 13.600v14.800";

type GlyphProps = Readonly<{
	/** Classe de preenchimento da mão e do punho. */
	handClass: string;
	/** Classe de preenchimento da moeda. */
	coinClass: string;
	/** Classe de traço dos detalhes (cifrão e dobra do polegar): a cor do fundo. */
	detailClass: string;
}>;

/** Só o desenho (mão + moeda), em um viewBox de 64×64, para compor dentro de outro SVG. */
export function BrandGlyph({ handClass, coinClass, detailClass }: GlyphProps) {
	return (
		<>
			<circle cx="37" cy="21" r="10" className={coinClass} />
			<path d={CIFRAO} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={detailClass} />
			<rect x="7" y="37" width="9" height="18" rx="2.5" className={handClass} />
			<path d={HAND} className={handClass} />
			<path d={THUMB} fill="none" strokeWidth="2" strokeLinecap="round" className={detailClass} />
		</>
	);
}

export function BrandMark({ size = 40, className }: Readonly<{ size?: number; className?: string }>) {
	return (
		<svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className={className}>
			<rect width="64" height="64" rx="14" className="fill-primary-container" />
			<BrandGlyph handClass="fill-on-primary-container" coinClass="fill-primary" detailClass="stroke-primary-container" />
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
