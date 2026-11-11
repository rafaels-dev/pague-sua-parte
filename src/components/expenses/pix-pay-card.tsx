"use client";

import { Avatar, Banner, Button, Card, Icon, QrCode } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { PIX_KEY_LABELS, type PixKeyType } from "@/lib/pix/key";

const STEPS = ["Toque em “Copiar Pix Copia e Cola”.", "Abra o app do seu banco e vá em Pix.", "Escolha “Pix Copia e Cola” e cole o código."];

/**
 * Faixa de cima de um bloco de "conta": de quem é a parte. Sua parte = tom azul; pessoa sem celular que você cuida = tom âmbar,
 * com o avatar também âmbar, para nunca confundir as duas contas.
 */
export function AccountHeader({ id, name, managed }: Readonly<{ id: string; name: string; managed: boolean }>) {
	return (
		<div
			className={`flex items-center gap-3 px-5 py-3 ${
				managed ? "bg-tertiary-container text-on-tertiary-container" : "bg-secondary-container text-on-secondary-container"
			}`}
		>
			<Avatar name={name} size="sm" managed={managed} className={managed ? "bg-on-tertiary-container! text-tertiary-container!" : "bg-primary! text-on-primary!"} />
			<h2 id={id} className="min-w-0 break-words text-title-large">
				{managed ? (
					<>
						Parte de {name} <span className="whitespace-nowrap font-normal">(você cuida)</span>
					</>
				) : (
					"Sua parte"
				)}
			</h2>
		</div>
	);
}

/** Cartão de pagamento de uma parte: copiar o código Pix, ver o QR Code e, como alternativa, copiar a chave. */
export function PixPayCard({
	accountName,
	managed = false,
	shareCents,
	paidSoFarCents = 0,
	payeeName,
	pix,
	payload,
	qrOpen,
	codeFallback,
	onToggleQr,
	onCopyCode,
	onCopyKey,
	headingId = "sua-parte",
	due,
	canPay = false,
	onPaid,
}: Readonly<{
	/** "Vence em 10 de dezembro" (em vermelho quando venceu e está em aberto). */
	due?: { text: string; overdue: boolean } | null;
	/** Identificador do título (único quando há mais de um cartão na tela). */
	headingId?: string;
	/** Quando a pessoa logada tem mais de uma conta (ou cuida de alguém), cada cartão leva a faixa com o nome de quem deve. */
	accountName?: string;
	/** A parte é de uma pessoa sem celular que você cuida. */
	managed?: boolean;
	/** Quanto falta pagar (o valor do código Pix). */
	shareCents: number;
	/** Se a pessoa já pagou uma parte, avisa quanto e que o código é só do que falta. */
	paidSoFarCents?: number;
	payeeName: string;
	pix: { type: PixKeyType; key: string };
	/** Código "Copia e Cola"; null se não foi possível gerar. */
	payload: string | null;
	qrOpen: boolean;
	/** Quando copiar automaticamente falhou: mostra o código num campo para copiar à mão. */
	codeFallback: boolean;
	onToggleQr: () => void;
	onCopyCode: () => void;
	onCopyKey: () => void;
	/** Mostra "Já paguei" (você pode avisar o pagamento desta parte). */
	canPay?: boolean;
	/** Abre o sheet "Já paguei". */
	onPaid?: () => void;
}>) {
	return (
		<Card as="section" tone="high" aria-labelledby={headingId} className="overflow-hidden">
			{accountName !== undefined && <AccountHeader id={headingId} name={accountName} managed={managed} />}
			<div className="space-y-5 p-5 md:p-6">
			<div>
				{accountName === undefined ? (
					<h2 id={headingId} className="text-title-large text-on-surface-variant">
						{paidSoFarCents > 0 ? "Falta pagar" : "Sua parte"}
					</h2>
				) : (
					<p className="text-title-large text-on-surface-variant">{paidSoFarCents > 0 ? "Falta pagar" : managed ? `${accountName} deve` : "Você deve"}</p>
				)}
				<p className="money text-display-small font-bold text-error">{formatBRL(shareCents)}</p>
				<p className="text-body-large text-on-surface-variant">para {payeeName}</p>
				{due && (
					<p className={`mt-1 flex items-center gap-1.5 text-body-large font-medium ${due.overdue ? "text-error" : "text-on-surface"}`}>
						<Icon name={due.overdue ? "warning" : "calendar_today"} size={20} />
						{due.text}
					</p>
				)}
				{paidSoFarCents > 0 && (
					<p className="mt-1 text-body-large text-on-surface">
						{managed ? `${accountName} já pagou` : "Você já pagou"} {formatBRL(paidSoFarCents)}; falta {formatBRL(shareCents)}.
					</p>
				)}
			</div>

			{payload ? (
				<>
					<Button icon="content_copy" fullWidth onClick={onCopyCode}>
						Copiar Pix Copia e Cola
					</Button>

					<ol className="space-y-2">
						{STEPS.map((s, i) => (
							<li key={s} className="flex items-start gap-3 text-body-large">
								<span
									aria-hidden="true"
									className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-container text-sm font-bold text-on-secondary-container"
								>
									{i + 1}
								</span>
								<span className="pt-0.5">{s}</span>
							</li>
						))}
					</ol>

					{codeFallback && (
						<div className="space-y-2">
							<p role="alert" className="text-body-large text-on-surface">
								Não deu para copiar sozinho. Toque no código abaixo, selecione tudo e copie.
							</p>
							<textarea
								readOnly
								rows={4}
								value={payload}
								aria-label="Código Pix Copia e Cola"
								onFocus={(e) => e.currentTarget.select()}
								className="w-full resize-none break-all rounded-shape-sm border border-outline bg-surface p-3 font-mono text-sm text-on-surface"
							/>
						</div>
					)}

					<div>
						<Button
							variant="tonal"
							size="md"
							icon="qr_code"
							onClick={onToggleQr}
							fullWidth
							aria-expanded={qrOpen}
							className="sm:w-auto"
						>
							{qrOpen ? "Esconder QR Code" : "Mostrar QR Code"}
						</Button>
						{qrOpen && (
							<div className="mt-4 flex flex-col items-center gap-2">
								<QrCode value={payload} size={224} label={`QR Code Pix de ${formatBRL(shareCents)} para ${payeeName}`} className="rounded-shape-md" />
								<p className="text-center text-body-large text-on-surface-variant">Para pagar de outro celular: aponte a câmera do app do banco.</p>
							</div>
						)}
					</div>
				</>
			) : (
				<Banner tone="error" icon="error" role="alert">
					Não foi possível gerar o código Pix. Use a chave abaixo.
				</Banner>
			)}

			<div className="flex items-center gap-3 border-t border-outline-variant pt-4">
				<div className="min-w-0 flex-1">
					<p className="text-body-large text-on-surface-variant">Ou pague pela chave ({PIX_KEY_LABELS[pix.type]})</p>
					<p className="break-all text-body-large font-medium">{pix.key}</p>
				</div>
				<Button variant="text" size="md" onClick={onCopyKey} className="shrink-0">
					Copiar chave
				</Button>
			</div>

			{canPay && onPaid && (
				<div className="space-y-2 border-t border-outline-variant pt-4">
					<p className="text-body-large text-on-surface-variant">
						{managed && accountName ? `Depois que ${accountName} pagar, avise aqui.` : "Depois de pagar, avise aqui."}
					</p>
					<Button variant="tonal" icon="check" fullWidth onClick={onPaid}>
						Já paguei
					</Button>
				</div>
			)}
			</div>
		</Card>
	);
}
