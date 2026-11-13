"use client";

import { useState } from "react";
import { Button, MoneyField, SegmentedButton } from "@/components/ui";
import type { CashbackMode } from "@/lib/expenses/cashback";

const MODES = [
	{ value: "first", label: "Abater da primeira parcela" },
	{ value: "spread", label: "Dividir igual em todas as parcelas" },
] as const;

/**
 * "Teve cashback?": começa recolhido, para quem não teve cashback não ver nada a mais.
 * Só se informa ao lançar. Com parcelas, pergunta como o cashback entra nas parcelas.
 */
export function CashbackField({
	cents,
	onCents,
	mode,
	onMode,
	installments,
	error,
	summary,
}: Readonly<{
	cents: number;
	onCents: (c: number) => void;
	mode: CashbackMode;
	onMode: (m: CashbackMode) => void;
	/** Compra parcelada: mostra a escolha de como dividir o cashback. */
	installments: boolean;
	error?: string;
	/** Texto de apoio já calculado ("Fica R$ 950,00 para dividir ..."). */
	summary?: string | null;
}>) {
	const [open, setOpen] = useState(cents > 0);
	if (!open) {
		return (
			<Button variant="text" size="md" icon="add" onClick={() => setOpen(true)} className="-ml-4">
				Teve cashback?
			</Button>
		);
	}
	return (
		<div className="space-y-3">
			<MoneyField id="campo-cashback" label="Cashback (se teve)" cents={cents} onChange={onCents} error={error} supportingText={summary ?? "O cashback baixa o valor que o grupo divide."} />
			{installments && (
				<div className="space-y-2">
					<p className="text-title-medium text-on-surface-variant">Como abater o cashback?</p>
					<SegmentedButton label="Como o cashback entra nas parcelas" value={mode} options={MODES} onChange={onMode} />
				</div>
			)}
			<Button
				variant="text"
				size="md"
				onClick={() => {
					onCents(0);
					setOpen(false);
				}}
				className="-ml-4"
			>
				Não teve cashback
			</Button>
		</div>
	);
}
