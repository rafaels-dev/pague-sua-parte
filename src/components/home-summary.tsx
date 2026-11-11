import { Card } from "@/components/ui";
import { formatBRL } from "@/lib/money";

/** Cartão-resumo da tela inicial: quanto a pessoa tem a receber e a pagar (em centavos). */
export function HomeSummary({ receiveCents, payCents }: Readonly<{ receiveCents: number; payCents: number }>) {
	return (
		<Card as="section" tone="high" aria-label="Resumo" className="grid grid-cols-2 gap-4 p-5 md:p-8">
			<div className="min-w-0">
				<p className="text-body-large text-on-surface-variant">Você tem a receber</p>
				<p className="money mt-1 text-headline-small font-bold text-receive md:text-headline-large md:font-bold">{formatBRL(receiveCents)}</p>
			</div>
			<div className="min-w-0 border-l border-outline-variant pl-4 md:pl-8">
				<p className="text-body-large text-on-surface-variant">Você tem a pagar</p>
				<p className="money mt-1 text-headline-small font-bold text-pay md:text-headline-large md:font-bold">{formatBRL(payCents)}</p>
			</div>
		</Card>
	);
}
