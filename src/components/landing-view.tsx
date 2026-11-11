import { BrandGlyph, BrandMark } from "@/components/brand";

/** Ilustração decorativa: a mãozinha da marca recebendo a moeda, em tamanho grande. */
function Illustration() {
	return (
		<svg viewBox="0 0 64 64" aria-hidden="true" className="h-auto w-full max-w-xs">
			<circle cx="32" cy="34" r="30" className="fill-primary/15" />
			<BrandGlyph handClass="fill-primary" coinClass="fill-primary" detailClass="stroke-primary-container" />
		</svg>
	);
}

/** Tela inicial: marca, frase de valor e (no slot) o botão de entrar. */
export function LandingView({ children, footer }: Readonly<{ children: React.ReactNode; footer: React.ReactNode }>) {
	return (
		<main className="mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-8 px-5 py-10 md:grid-cols-2 md:gap-14 md:px-8">
			<div aria-hidden="true" className="hidden items-center justify-center rounded-shape-lg bg-primary-container py-16 md:flex">
				<Illustration />
			</div>

			<div className="flex flex-col gap-8">
				<div className="space-y-4">
					<BrandMark size={64} />
					<h1 className="text-display-small font-bold md:text-headline-large md:font-bold">PagueSuaParte</h1>
					<p className="text-title-large text-on-surface-variant">
						Registre os gastos da família, veja quanto cada um deve e pague por Pix com comprovante.
					</p>
				</div>
				<div className="space-y-4">{children}</div>
				<p className="text-body-large text-on-surface-variant">{footer}</p>
			</div>
		</main>
	);
}
