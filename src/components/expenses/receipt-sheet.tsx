"use client";

import { Banner, Button } from "@/components/ui";
import { receiptSheetCopy, type ReceiptMode } from "@/lib/ui/receipts";
import { AttachmentPicker } from "./attachment-picker";
import { useAttachments, type PickedFile } from "./use-attachments";

const PICKER_COPY = {
	title: "Comprovante",
	optional: false,
	hint: "Foto, print ou PDF do comprovante do Pix.",
	pick: "Escolher foto ou PDF",
	pickAgain: "Trocar arquivo",
	inputLabel: "Escolher o comprovante",
};

/** Conteúdo (visual) do sheet "Já paguei" / "Anexar comprovante". */
export function ReceiptSheetContent({
	mode,
	payeeName,
	count = 0,
	partialCents,
	items,
	problems,
	processing,
	dragging,
	canPaste,
	busy,
	error,
	fileError,
	onPick,
	onRemove,
	onPaste,
	onSend,
	onSkip,
	onCancel,
}: Readonly<{
	mode: ReceiptMode;
	payeeName: string;
	/** Quantas contas o comprovante cobre ("Já paguei tudo"). */
	count?: number;
	/** Pagamento parcial: quanto foi pago (vai no título). */
	partialCents?: number;
	items: PickedFile[];
	problems: string[];
	processing: boolean;
	dragging: boolean;
	canPaste: boolean;
	busy: boolean;
	/** Erro geral (aparece em faixa vermelha). */
	error: string | null;
	/** Erro do arquivo (aparece embaixo do seletor). */
	fileError: string | null;
	onPick: (files: File[]) => void;
	onRemove: (id: string) => void;
	onPaste: () => void;
	onSend: () => void;
	onSkip: () => void;
	onCancel: () => void;
}>) {
	const copy = receiptSheetCopy(mode, payeeName, count, partialCents);
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">{copy.intro}</p>
			<AttachmentPicker
				items={items}
				problems={problems}
				serverError={fileError}
				processing={processing}
				dragging={dragging}
				canPaste={canPaste}
				disabled={busy}
				maxFiles={1}
				copy={PICKER_COPY}
				onPick={onPick}
				onRemove={onRemove}
				onPaste={onPaste}
			/>
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button icon="check" onClick={onSend} loading={busy} disabled={items.length === 0 || processing || busy} fullWidth>
					{busy ? "Enviando..." : copy.send}
				</Button>
				{copy.skip ? (
					<Button variant="outlined" onClick={onSkip} disabled={busy || processing} fullWidth>
						{copy.skip}
					</Button>
				) : (
					<Button variant="text" onClick={onCancel} disabled={busy} fullWidth>
						Cancelar
					</Button>
				)}
			</div>
		</div>
	);
}

/**
 * Sheet com o seletor de UM arquivo. Fica montado só enquanto o sheet está aberto (o estado do arquivo
 * recomeça a cada abertura), e o arquivo escolhido sobrevive a um erro de envio.
 */
export function ReceiptSheetBody({
	mode,
	payeeName,
	count = 0,
	partialCents,
	busy,
	error,
	fileError,
	onSubmit,
	onCancel,
}: Readonly<{
	mode: ReceiptMode;
	payeeName: string;
	count?: number;
	partialCents?: number;
	busy: boolean;
	error: string | null;
	fileError: string | null;
	onSubmit: (file: File | null) => void;
	onCancel: () => void;
}>) {
	const att = useAttachments({ enabled: !busy, maxFiles: 1 });
	return (
		<ReceiptSheetContent
			mode={mode}
			payeeName={payeeName}
			count={count}
			partialCents={partialCents}
			items={att.items}
			problems={att.problems}
			processing={att.processing}
			dragging={att.dragging}
			canPaste={att.canReadClipboard}
			busy={busy}
			error={error}
			fileError={fileError}
			onPick={att.addFiles}
			onRemove={att.remove}
			onPaste={() => void att.pasteFromClipboard()}
			onSend={() => onSubmit(att.items[0]?.file ?? null)}
			onSkip={() => onSubmit(null)}
			onCancel={onCancel}
		/>
	);
}
