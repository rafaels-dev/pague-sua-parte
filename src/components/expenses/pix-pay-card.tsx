"use client";

import { Banner, Button, Card, QrCode } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { PIX_KEY_LABELS, type PixKeyType } from "@/lib/pix/key";

const STEPS = ["Toque em “Copiar Pix Copia e Cola”.", "Abra o app do seu banco e vá em Pix.", "Escolha “Pix Copia e Cola” e cole o código."];

/** Cartão "Sua parte": copiar o código Pix, ver o QR Code e, como alternativa, copiar a chave. */
export function PixPayCard({
	shareCents,
	payeeName,
	pix,
	payload,
	qrOpen,
	codeFallback,
	onToggleQr,
	onCopyCode,
	onCopyKey,
}: Readonly<{
	shareCents: number;
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
	return (
		<Card as="section" tone="high" aria-labelledby="sua-parte" className="space-y-5 p-5 md:p-6">
			<div>
				<h2 id="sua-parte" className="text-title-large text-on-surface-variant">
					Sua parte
				</h2>
				<p className="money text-display-small font-bold text-error">{formatBRL(shareCents)}</p>
				<p className="text-body-large text-on-surface-variant">para {payeeName}</p>
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

			<p
				aria-disabled="true"
				className="rounded-shape-md border border-dashed border-outline-variant px-4 py-3 text-center text-body-large text-on-surface-variant"
			>
				Em breve: enviar comprovante
			</p>
		</Card>
	);
}
