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

/** Aviso no WhatsApp: um toque leva a despesa para o grupo. */
export function ShareMock() {
	return (
		<Still className="inline-flex h-12 items-center gap-2 rounded-full bg-lp-ink px-6 text-label-large text-lp-paper">
			<Icon name="share" size={20} />
			<span>Avisar no WhatsApp</span>
		</Still>
	);
}

/** Plano "pré-grupo": quem vai, até quanto cada um pode pagar e quando a conta fecha. */
export function PlanMock() {
	return (
		<Still className="space-y-4 rounded-shape-lg bg-surface p-5 text-on-surface">
			<div>
				<p className="text-title-large">Hotel da viagem</p>
				<p className="money text-headline-medium font-bold">R$ 2.500,00</p>
			</div>
			<div className="space-y-3">
				{[
					["Ana", "Vou (sem limite)", "ok"],
					["Beto", "Vou (até R$ 350,00)", "ok"],
					["Dona Lúcia", "Não vou", "neutral"],
				].map(([name, answer, tone]) => (
					<div key={name} className="flex items-center justify-between gap-3">
						<span className="flex items-center gap-3 text-title-medium">
							<Avatar name={name} size="md" />
							{name}
						</span>
						<StatusChip tone={tone as "ok" | "neutral"}>{answer}</StatusChip>
					</div>
				))}
				<p className="text-body-large text-on-surface-variant">+ 6 pessoas vão</p>
			</div>
			<Card tone="high" className="p-4">
				<p className="text-title-medium">Fecha com 8 pessoas</p>
				<p className="money text-headline-small font-bold">R$ 312,50 cada</p>
			</Card>
		</Still>
	);
}

/** "Pagar tudo": o que a pessoa deve a quem recebe, num só Pix. */
export function PayAllMock() {
	return (
		<Still className="space-y-4">
			<div className="flex items-end justify-between gap-3">
				<p className="text-title-large">Para Mãe</p>
				<p className="money text-headline-small font-bold">R$ 143,20</p>
			</div>
			<p className="text-body-large text-on-surface-variant">3 despesas em 2 grupos</p>
			<Button icon="content_copy" fullWidth>
				Copiar Pix Copia e Cola
			</Button>
		</Still>
	);
}

/** Aviso no celular, como chega na tela. */
export function NoticeMock() {
	return (
		<Still className="flex items-start gap-3 rounded-shape-md bg-surface p-4 text-on-surface">
			<Avatar name="Tio Beto" size="md" />
			<div className="space-y-1">
				<p className="text-title-medium">Tio Beto pagou a parte dele</p>
				<p className="text-body-large text-on-surface-variant">Despesas da vó</p>
			</div>
		</Still>
	);
}
