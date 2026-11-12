"use client";

import { PixPayCard } from "@/components/expenses/pix-pay-card";
import { buildPixPayload } from "@/lib/pix/brcode";

const noop = () => {};

/** Cartão de pagamento Pix com a ajuda "O banco recusou o código?" aberta (dados de mentira). */
export function MockPixRefused({ helpOpen = true }: Readonly<{ helpOpen?: boolean }>) {
	const pix = { type: "cpf" as const, key: "52998224725" };
	return (
		<main className="mx-auto max-w-md p-4">
			<PixPayCard
				shareCents={15500}
				payeeName="Maria Silva"
				pix={pix}
				payload={buildPixPayload({ key: pix.key, payeeName: "Maria Silva", amountCents: 15500 })}
				qrOpen={false}
				codeFallback={false}
				onToggleQr={noop}
				onCopyCode={noop}
				onCopyKey={noop}
				helpOpen={helpOpen}
			/>
		</main>
	);
}
