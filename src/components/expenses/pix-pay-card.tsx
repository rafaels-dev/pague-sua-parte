"use client";

import { useState } from "react";
import { Avatar, Banner, Button, Card, Icon, QrCode, StatusChip } from "@/components/ui";
import { copyText } from "@/lib/ui/clipboard";
import { formatBRL } from "@/lib/money";
import { PIX_KEY_LABELS, type PixKeyType } from "@/lib/pix/key";
import { PARTIAL_CHIP, partialLine } from "@/lib/ui/partial-pay";

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

/** "155,00": o valor como o banco pede para digitar. */
function amountToType(cents: number): string {
	return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/** Ajuda recolhida para quando o banco recusa o Pix: pagar pela chave e o que fazer se isso também falhar. */
function PixRefusedHelp({ payeeName, defaultOpen }: Readonly<{ payeeName: string; defaultOpen: boolean }>) {
	const steps = [
		"Pague pela chave Pix mostrada abaixo: digite o valor no app do banco.",
		"Confira com quem recebe se a chave está certa e ativa no banco dele.",
		`Se pagar pela chave também não der, o problema está na conta de quem recebe. Peça para ${payeeName} falar com o banco ou cadastrar outra chave Pix no app. Enquanto isso, combine outro jeito de pagar e toque em “Já paguei”.`,
	];
	return (
		<details open={defaultOpen} className="group rounded-shape-md bg-surface-container-low">
			<summary className="state-layer flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-shape-md px-4 text-title-medium [&::-webkit-details-marker]:hidden">
				<span className="flex-1">O banco recusou o código?</span>
				<Icon name="expand_more" className="text-on-surface-variant transition-transform group-open:rotate-180" />
			</summary>
			<ol className="space-y-3 px-4 pb-4 pt-1">
				{steps.map((t, i) => (
					<li key={t} className="flex items-start gap-3 text-body-large">
						<span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-container text-sm font-bold text-on-secondary-container">
							{i + 1}
						</span>
						<span className="pt-0.5">{t}</span>
					</li>
				))}
			</ol>
		</details>
	);
}

/**
 * Parte de baixo do pagamento por Pix: copiar o código "Copia e Cola", passo a passo, QR Code e a chave como alternativa.
 * Usado tanto pela parte de uma despesa quanto por "Pagar tudo de uma vez".
 */
export function PixCodeBlock({
	amountCents,
	payeeName,
	pix,
	payload,
	qrOpen,
	codeFallback,
	onToggleQr,
	onCopyCode,
	onCopyKey,
	helpOpen = false,
	onOtherAmount,
}: Readonly<{
	/** Só para as telas de exemplo: ajuda "O banco recusou o código?" já aberta. */
	helpOpen?: boolean;
	/** Mostra o link discreto "Pagar outro valor" logo abaixo do botão de copiar (pagamento parcial). */
	onOtherAmount?: () => void;
	amountCents: number;
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
}>) {
	const [amountCopied, setAmountCopied] = useState(false);
	return (
		<div className="space-y-5">
				{payload ? (
					<>
						<div>
							<Button icon="content_copy" fullWidth onClick={onCopyCode}>
								Copiar Pix Copia e Cola
							</Button>
							{onOtherAmount && (
								<div className="mt-1 text-center">
									<Button variant="text" size="md" onClick={onOtherAmount}>
										Pagar outro valor
									</Button>
								</div>
							)}
						</div>

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
									<QrCode value={payload} size={224} label={`QR Code Pix de ${formatBRL(amountCents)} para ${payeeName}`} className="rounded-shape-md" />
									<p className="text-center text-body-large text-on-surface-variant">Para pagar de outro celular: aponte a câmera do app do banco.</p>
								</div>
							)}
						</div>

						<PixRefusedHelp payeeName={payeeName} defaultOpen={helpOpen} />
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
				<div className="flex items-center gap-3">
					<div className="min-w-0 flex-1">
						<p className="text-body-large text-on-surface-variant">Valor</p>
						<p className="money text-body-large font-medium">{formatBRL(amountCents)}</p>
					</div>
					<Button
						variant="text"
						size="md"
						onClick={() => {
							void copyText(amountToType(amountCents)).then((ok) => {
								setAmountCopied(ok);
								if (ok) setTimeout(() => setAmountCopied(false), 2500);
							});
						}}
						className="shrink-0"
					>
						{amountCopied ? "Valor copiado" : "Copiar valor"}
					</Button>
				</div>
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
	onOtherAmount,
	helpOpen,
}: Readonly<{
	/** Abre "Pagar outro valor" (paga só um pedaço da parte). Sem chave Pix o link não aparece no código; o botão "Já paguei" segue valendo. */
	onOtherAmount?: () => void;
	helpOpen?: boolean;
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
	/** `null` = quem recebe ainda não cadastrou a chave Pix: sem código nem QR, mas "Já paguei" continua valendo (dinheiro, outro meio). */
	pix: { type: PixKeyType; key: string } | null;
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
					<div className="mt-2 space-y-1">
						<StatusChip tone="wait">{PARTIAL_CHIP}</StatusChip>
						<p className="text-body-large text-on-surface">{partialLine(paidSoFarCents, shareCents)}</p>
					</div>
				)}
			</div>

			{pix ? (
				<PixCodeBlock
					amountCents={shareCents}
					payeeName={payeeName}
					pix={pix}
					payload={payload}
					qrOpen={qrOpen}
					codeFallback={codeFallback}
					onToggleQr={onToggleQr}
					onCopyCode={onCopyCode}
					onCopyKey={onCopyKey}
					helpOpen={helpOpen}
					onOtherAmount={canPay ? onOtherAmount : undefined}
				/>
			) : (
				<p className="text-body-large text-on-surface-variant">Ainda não há chave Pix de {payeeName} no app.</p>
			)}

			{/* Sem chave Pix, ou com a chave mas sem o código copia-e-cola (não deu para gerar): o link continua aqui, fora do bloco do código. */}
			{canPay && onOtherAmount && (!pix || !payload) && (
				<div className="text-center">
					<Button variant="text" size="md" onClick={onOtherAmount}>
						Pagar outro valor
					</Button>
				</div>
			)}

			{canPay && onPaid && (
				<div className="space-y-2 border-t border-outline-variant pt-4">
					<p className="text-body-large text-on-surface-variant">
						{!pix ? "Se pagou de outro jeito, avise aqui." : managed && accountName ? `Depois que ${accountName} pagar, avise aqui.` : "Depois de pagar, avise aqui."}
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
