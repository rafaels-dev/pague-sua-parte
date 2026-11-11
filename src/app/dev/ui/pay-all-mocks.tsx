"use client";

import { useState } from "react";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { ReceiptSheetContent } from "@/components/expenses/receipt-sheet";
import type { PickedFile } from "@/components/expenses/use-attachments";
import { EMPTY_CARD, PayAllView, type CardState, type DoneBatch, type PayAllPageState } from "@/components/pay-all/pay-all-view";
import { doneShareText } from "@/components/pay-all/pay-all-page";
import { Sheet } from "@/components/ui";
import { todayISO } from "@/lib/ui/dates";
import { nextDayOfMonth } from "@/lib/ui/due-dates";
import { itemKey, selectedItems, selectedTotal, toggleUnchecked, type PayableItem, type PayableRecipient } from "@/lib/ui/pay-all";
import { Shell } from "./expense-mocks";

const noop = () => {};
const TODAY = todayISO();
const daysAgo = (n: number) => {
	const d = new Date(`${TODAY}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
};
const THIS_MONTH_END = `${TODAY.slice(0, 8)}28`;

const item = (o: Partial<PayableItem> & Pick<PayableItem, "expenseId" | "description" | "dueCents">): PayableItem => ({
	groupId: "1",
	groupName: "Despesas da vó",
	shareUid: "a",
	shareName: "Rafael Schettino",
	isYou: true,
	dueDate: null,
	overdue: false,
	installment: null,
	recurrence: false,
	...o,
});

const total = (items: PayableItem[]) => items.reduce((s, i) => s + i.dueCents, 0);

const MARIA_ITEMS: PayableItem[] = [
	item({ expenseId: "e1", description: "Remédios da farmácia", dueCents: 7248 }),
	item({ expenseId: "e2", description: "Mercado do mês", dueCents: 10000, dueDate: daysAgo(6), overdue: true }),
	item({ expenseId: "e3", description: "Geladeira nova", dueCents: 12000, dueDate: nextDayOfMonth(TODAY, 28) || THIS_MONTH_END, installment: { number: 2, count: 6 } }),
	item({ expenseId: "e4", description: "Fraldas geriátricas", dueCents: 3333, shareUid: "m1", shareName: "Benjamim", isYou: false }),
	item({ expenseId: "e5", description: "Aluguel da casa da vó", dueCents: 40000, groupId: "2", groupName: "Casa da praia", recurrence: true }),
];
const JOSE_ITEMS: PayableItem[] = [
	item({ expenseId: "e6", description: "Cuidadora de sábado", dueCents: 8000 }),
	item({ expenseId: "e7", description: "Passagem de ônibus", dueCents: 2500 }),
];

export const RECIPIENTS: PayableRecipient[] = [
	{
		id: "r1",
		payee: { uid: "b", name: "Maria das Dores Silva", picture: null, kind: "user" },
		pix: { type: "cpf", key: "52998224725", payeeName: "Maria das Dores Silva" },
		totalCents: total(MARIA_ITEMS),
		items: MARIA_ITEMS,
	},
	{
		id: "r2",
		payee: { uid: "c", name: "José Pereira", picture: null, kind: "user" },
		pix: { type: "email", key: "jose.pereira@example.com", payeeName: "José Pereira" },
		totalCents: total(JOSE_ITEMS),
		items: JOSE_ITEMS,
	},
];

const DONE_FULL: DoneBatch = {
	id: "b1",
	payeeName: "Maria das Dores Silva",
	paidCents: total(MARIA_ITEMS.slice(0, 3)),
	paidItems: MARIA_ITEMS.slice(0, 3),
	failed: [],
	hasReceipt: true,
};

const DONE_PARTIAL: DoneBatch = {
	id: "b2",
	payeeName: "Maria das Dores Silva",
	paidCents: total(MARIA_ITEMS.slice(0, 2)),
	paidItems: MARIA_ITEMS.slice(0, 2),
	failed: [
		{ item: MARIA_ITEMS[2], reason: "already_paid" },
		{ item: MARIA_ITEMS[3], reason: "conflict" },
	],
	hasReceipt: false,
};

export type PayAllScene = "lista" | "pix" | "desmarcado" | "nada" | "comprovante" | "comprovante-arquivo" | "pago" | "parcial" | "avisar" | "vazio" | "carregando" | "erro" | "indisponivel";

const sceneState = (scene: PayAllScene): PayAllPageState => {
	switch (scene) {
		case "carregando":
			return { kind: "loading" };
		case "erro":
			return { kind: "error", message: "Sem conexão. Verifique sua internet e tente de novo." };
		case "indisponivel":
			return { kind: "unavailable" };
		case "vazio":
			return { kind: "ready", recipients: [], done: [] };
		case "pago":
			return { kind: "ready", recipients: RECIPIENTS.slice(1), done: [DONE_FULL] };
		case "avisar":
			return { kind: "ready", recipients: RECIPIENTS.slice(1), done: [DONE_FULL] };
		case "parcial":
			return { kind: "ready", recipients: [{ ...RECIPIENTS[0], items: MARIA_ITEMS.slice(3), totalCents: total(MARIA_ITEMS.slice(3)) }, RECIPIENTS[1]], done: [DONE_PARTIAL] };
		default:
			return { kind: "ready", recipients: RECIPIENTS, done: [] };
	}
};

const sceneCards = (scene: PayAllScene): Record<string, CardState> => {
	const all = RECIPIENTS[0].items;
	if (scene === "pix") return { r1: { ...EMPTY_CARD, pixCents: RECIPIENTS[0].totalCents, qrOpen: true } };
	if (scene === "desmarcado") return { r1: { ...EMPTY_CARD, unchecked: [itemKey(all[1]), itemKey(all[4])] } };
	if (scene === "nada") return { r2: { ...EMPTY_CARD, unchecked: RECIPIENTS[1].items.map(itemKey) } };
	if (scene === "comprovante" || scene === "comprovante-arquivo") return { r1: { ...EMPTY_CARD, pixCents: RECIPIENTS[0].totalCents } };
	return {};
};

const FILE: PickedFile = {
	id: "r1",
	file: new File([new Blob(["x".repeat(210_000)])], "comprovante-pix.png", { type: "image/png" }),
	kind: "image",
	previewUrl: null,
};

/** "Pagar tudo" com dados de mentira: o botão de gerar Pix, marcar e desmarcar e o QR funcionam; o resto só mostra. */
export function MockPayAll({ scene = "lista", framed = true }: Readonly<{ scene?: PayAllScene; framed?: boolean }>) {
	const [cards, setCards] = useState<Record<string, CardState>>(() => sceneCards(scene));
	const [receiptOpen, setReceiptOpen] = useState(scene === "comprovante" || scene === "comprovante-arquivo");
	const [shareOpen, setShareOpen] = useState(scene === "avisar");
	const state = sceneState(scene);
	const card = (id: string) => cards[id] ?? EMPTY_CARD;
	const patch = (id: string, p: Partial<CardState>) => setCards((c) => ({ ...c, [id]: { ...(c[id] ?? EMPTY_CARD), ...p } }));
	const recipients = state.kind === "ready" ? state.recipients : [];
	const find = (id: string) => recipients.find((r) => r.id === id);
	const receiptFor = recipients.find((r) => r.id === "r1") ?? recipients[0];
	const count = receiptFor ? selectedItems(receiptFor.items, card(receiptFor.id).unchecked).length : 0;
	return (
		<Shell pathname="/app/pagar" framed={framed}>
			<PayAllView
				state={state}
				cards={cards}
				onToggleItem={(id, key) => patch(id, { unchecked: toggleUnchecked(card(id).unchecked, key), qrOpen: false })}
				onGenerate={(id) => {
					const r = find(id);
					if (r) patch(id, { pixCents: selectedTotal(r.items, card(id).unchecked), qrOpen: false });
				}}
				onToggleQr={(id) => patch(id, { qrOpen: !card(id).qrOpen })}
				onCopyCode={noop}
				onCopyKey={noop}
				onPaid={() => setReceiptOpen(true)}
				onTell={() => setShareOpen(true)}
				onRetry={noop}
			/>
			<Sheet open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Já paguei tudo">
				<ReceiptSheetContent
					mode="batch"
					payeeName={receiptFor?.payee.name ?? ""}
					count={count}
					items={scene === "comprovante-arquivo" ? [FILE] : []}
					problems={[]}
					processing={false}
					dragging={false}
					canPaste
					busy={false}
					error={null}
					fileError={null}
					onPick={noop}
					onRemove={noop}
					onPaste={noop}
					onSend={() => setReceiptOpen(false)}
					onSkip={() => setReceiptOpen(false)}
					onCancel={() => setReceiptOpen(false)}
				/>
			</Sheet>
			<Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Avisar no WhatsApp">
				<ShareExpenseContent
					text={doneShareText(DONE_FULL, "https://pague-sua-parte.app")}
					intro="Mande para Maria das Dores Silva saber que você pagou. O link abre o grupo, com o seu comprovante."
					canShare
					copyFailed={false}
					onCopy={noop}
					onShare={noop}
					onClose={() => setShareOpen(false)}
				/>
			</Sheet>
		</Shell>
	);
}
