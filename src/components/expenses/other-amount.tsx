"use client";

import { Button, MoneyField } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { amountHint, checkAmount } from "@/lib/ui/partial-pay";

/**
 * Conteúdo (visual) do sheet "Pagar outro valor": a pessoa digita quanto vai pagar agora (menos do que falta), copia o Pix
 * desse valor e depois avisa que pagou. A parte continua em aberto com o que sobrar.
 */
export function OtherAmountContent({
	dueCents,
	payeeName,
	cents,
	hasPix,
	canCopy,
	onCents,
	onCopy,
	onCopyKey,
	onPaid,
	onCancel,
}: Readonly<{
	/** O que falta pagar da parte. */
	dueCents: number;
	payeeName: string;
	/** Valor digitado (centavos; 0 = vazio). */
	cents: number;
	/** Quem recebe tem chave Pix cadastrada. */
	hasPix: boolean;
	/** Dá para gerar o código Pix copia-e-cola deste valor. */
	canCopy: boolean;
	onCents: (cents: number) => void;
	onCopy: () => void;
	/** Copia a chave Pix (caminho "pague pela chave", quando não há código Pix copia-e-cola). */
	onCopyKey?: () => void;
	/** Segue para "Já paguei" (comprovante opcional) com este valor. */
	onPaid: () => void;
	onCancel: () => void;
}>) {
	const check = checkAmount(cents, dueCents);
	const valid = check.kind === "part" || check.kind === "full";
	return (
		<div className="space-y-5">
			<p className="text-body-large text-on-surface-variant">
				Falta pagar {formatBRL(dueCents)} para {payeeName}. Digite quanto você vai pagar agora.
			</p>
			<MoneyField
				id="outro-valor"
				label="Valor que vou pagar"
				cents={cents}
				onChange={onCents}
				autoFocus
				error={check.kind === "too_much" ? check.message : null}
				supportingText={amountHint(check)}
			/>
			{valid && hasPix && canCopy && (
				<div className="space-y-2">
					<Button icon="content_copy" fullWidth onClick={onCopy}>
						Copiar Pix Copia e Cola
					</Button>
					<p className="text-body-large text-on-surface-variant">Cole no app do seu banco e pague. Depois volte aqui e toque em “Já paguei”.</p>
				</div>
			)}
			{valid && hasPix && !canCopy && (
				<div className="space-y-2">
					<p className="text-body-large text-on-surface-variant">Não foi possível gerar o código Pix. Pague pela chave: digite {formatBRL(cents)} no app do seu banco.</p>
					{onCopyKey && (
						<Button icon="content_copy" fullWidth onClick={onCopyKey}>
							Copiar chave Pix
						</Button>
					)}
				</div>
			)}
			{valid && !hasPix && <p className="text-body-large text-on-surface-variant">Ainda não há chave Pix de {payeeName} no app. Se pagou de outro jeito, avise aqui.</p>}
			<div className="flex flex-col gap-3">
				<Button variant={hasPix && (canCopy || onCopyKey) ? "tonal" : "filled"} icon="check" fullWidth disabled={!valid} onClick={onPaid}>
					{valid ? `Já paguei ${formatBRL(cents)}` : "Já paguei"}
				</Button>
				<Button variant="text" fullWidth onClick={onCancel}>
					Cancelar
				</Button>
			</div>
		</div>
	);
}
