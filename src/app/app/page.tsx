import { formatBRL } from "@/lib/money";

export const metadata = { title: "Início" };

export default function AppHome() {
	// TODO: valores reais virão da API (saldos por grupo).
	return (
		<div className="space-y-5">
			<h1 className="text-3xl font-bold">Olá!</h1>

			<section className="rounded-2xl border border-border bg-card p-5">
				<p className="text-base text-muted">Você tem a receber</p>
				<p className="text-4xl font-bold text-receive">{formatBRL(0)}</p>
			</section>

			<section className="rounded-2xl border border-border bg-card p-5">
				<p className="text-base text-muted">Você tem a pagar</p>
				<p className="text-4xl font-bold text-pay">{formatBRL(0)}</p>
			</section>
		</div>
	);
}
