"use client";

import { Button } from "@/components/ui";
import { buildWhatsAppUrl } from "@/lib/ui/invite";

/** Conteúdo (visual) do sheet "Avisar o grupo": WhatsApp, compartilhar, copiar a mensagem. */
export function ShareExpenseContent({
	text,
	intro,
	canShare,
	copyFailed,
	dismissLabel = "Agora não",
	whatsappLabel = "Avisar no WhatsApp",
	preview = false,
	onCopy,
	onShare,
	onClose,
}: Readonly<{
	text: string;
	intro: string;
	canShare: boolean;
	copyFailed: boolean;
	dismissLabel?: string;
	whatsappLabel?: string;
	/** Mostra a mensagem pronta antes dos botões (resumos). */
	preview?: boolean;
	onCopy: () => void;
	onShare: () => void;
	onClose: () => void;
}>) {
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">{intro}</p>
			{preview && (
				<pre aria-label="Prévia da mensagem" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-shape-md bg-surface-container-high p-4 font-sans text-body-large text-on-surface">
					{text}
				</pre>
			)}
			<div className="flex flex-col gap-3">
				<Button href={buildWhatsAppUrl(text)} target="_blank" rel="noopener noreferrer" icon="share" fullWidth>
					{whatsappLabel}
				</Button>
				{canShare && (
					<Button variant="outlined" icon="share" onClick={onShare} fullWidth>
						Compartilhar de outro jeito
					</Button>
				)}
				<Button variant="tonal" icon="content_copy" onClick={onCopy} fullWidth>
					Copiar mensagem
				</Button>
			</div>
			{copyFailed && (
				<div className="space-y-2">
					<p role="alert" className="text-body-large text-on-surface">
						Não deu para copiar sozinho. Toque na mensagem abaixo, selecione tudo e copie.
					</p>
					<textarea
						readOnly
						rows={4}
						value={text}
						aria-label="Mensagem para o grupo"
						onFocus={(e) => e.currentTarget.select()}
						className="w-full resize-none rounded-shape-sm border border-outline bg-surface p-3 text-body-large text-on-surface"
					/>
				</div>
			)}
			<Button variant="text" size="md" onClick={onClose} fullWidth>
				{dismissLabel}
			</Button>
		</div>
	);
}
