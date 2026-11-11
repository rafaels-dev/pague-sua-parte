import { Greeting } from "@/components/greeting";
import { PixKeyWarning } from "@/components/pix-key-warning";
import { formatBRL } from "@/lib/money";

export const metadata = { title: "Início" };

export default function AppHome() {
	// TODO: valores reais virão da API (saldos por grupo).
	return (
		<div className="space-y-5">
			<Greeting />

			<PixKeyWarning />

			<div className="grid gap-5 md:grid-cols-2">
				<section className="rounded-2xl border border-border bg-card p-5 md:p-7">
					<p className="text-base text-muted">Você tem a receber</p>
					<p className="text-4xl font-bold text-receive">{formatBRL(0)}</p>
				</section>

				<section className="rounded-2xl border border-border bg-card p-5 md:p-7">
					<p className="text-base text-muted">Você tem a pagar</p>
					<p className="text-4xl font-bold text-pay">{formatBRL(0)}</p>
				</section>
			</div>
		</div>
	);
}
