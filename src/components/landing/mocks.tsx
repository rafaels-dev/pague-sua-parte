import { Avatar, Button, Card, Icon, StatusChip } from "@/components/ui";

/**
 * Peças do app em miniatura, montadas com o próprio kit de interface e nomes de exemplo.
 * São só para olhar: ficam fora da leitura de tela e fora da ordem do Tab (`inert`).
 */
function Still({ children, className }: Readonly<{ children: React.ReactNode; className?: string }>) {
	return (
		<div aria-hidden="true" inert className={className}>
			{children}
		</div>
	);
}

/** A tela "Sua parte" do app: quanto você deve e o botão do Pix Copia e Cola. */
export function PixScreenMock() {
	return (
		<Still className="space-y-5 rounded-shape-lg bg-surface p-5 text-on-surface">
			<div className="space-y-1">
				<p className="text-title-large">Remédios da farmácia</p>
				<p className="money text-headline-medium font-bold">R$ 289,90</p>
				<p className="text-body-large text-on-surface-variant">Pago por Mãe</p>
			</div>
			<Card tone="default" className="space-y-4 p-5">
				<div>
					<p className="text-title-large text-on-surface-variant">Sua parte</p>
					<p className="money text-headline-large font-bold text-pay">R$ 72,48</p>
				</div>
				<Button icon="content_copy" fullWidth size="md">
					Copiar Pix Copia e Cola
				</Button>
				<Button icon="qr_code" variant="tonal" fullWidth size="md">
					Mostrar QR Code
				</Button>
			</Card>
		</Still>
	);
}

/** "Quero ajudar": quem está pagando sozinho recebe a ajuda de quem quiser entrar na divisão. */
export function HelpMock() {
	return (
		<Still className="space-y-4">
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
					<Icon name="favorite" size={20} />
				</span>
				<p className="text-title-large">Mãe está arcando com esta despesa sozinha.</p>
			</div>
			<Button icon="favorite" fullWidth>
				Quero ajudar
			</Button>
		</Still>
	);
}

/** Pessoa sem celular, cuidada por um parente. */
export function CareMock() {
	return (
		<Still className="flex items-center gap-3">
			<Avatar name="Vô Antônio" size="lg" managed />
			<div className="space-y-1">
				<p className="text-title-large">Vô Antônio</p>
				<StatusChip tone="wait">Sem celular, você cuida</StatusChip>
			</div>
		</Still>
	);
}

/** Parcelas do cartão, cada uma com o seu vencimento. */
export function InstallmentsMock() {
	return (
		<Still className="space-y-2">
			{[
				["Parcela 1 de 3", "10 de dezembro", "ok"],
				["Parcela 2 de 3", "10 de janeiro", "wait"],
				["Parcela 3 de 3", "10 de fevereiro", "wait"],
			].map(([parcela, data, tone]) => (
				<div key={parcela} className="flex items-center justify-between gap-3">
					<div>
						<p className="text-title-medium">{parcela}</p>
						<p className="text-body-large text-on-surface-variant">{data}</p>
					</div>
					<StatusChip tone={tone as "ok" | "wait"}>{tone === "ok" ? "Paga" : "Falta pagar"}</StatusChip>
				</div>
			))}
		</Still>
	);
}

/** Relatório: quem pagou mais e quem pagou menos. As barras têm tamanhos diferentes porque os valores são diferentes. */
export function ReportMock() {
	const rows = [
		{ name: "Mãe", value: "R$ 420", width: "100%" },
		{ name: "Tio Beto", value: "R$ 260", width: "62%" },
		{ name: "Ana", value: "R$ 90", width: "21%" },
	];
	return (
		<Still className="space-y-3">
			{rows.map((r) => (
				<div key={r.name} className="space-y-1">
					<div className="flex justify-between text-title-medium">
						<span>{r.name}</span>
						<span className="money">{r.value}</span>
					</div>
					<div className="h-3 rounded-full bg-lp-on-field/15">
						<div className="h-3 rounded-full bg-lp-on-field" style={{ width: r.width }} />
					</div>
				</div>
			))}
		</Still>
	);
}

/** Aviso no WhatsApp: um toque leva a despesa para o grupo. */
export function ShareMock() {
	return (
		<Still className="inline-flex h-12 items-center gap-2 rounded-full bg-lp-ink px-6 text-label-large text-lp-paper">
			<Icon name="share" size={20} />
			<span>Avisar no WhatsApp</span>
		</Still>
	);
}
