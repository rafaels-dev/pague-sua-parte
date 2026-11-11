"use client";

import { Avatar, Banner, Button, Card, EmptyState, Icon, Skeleton, StatusChip } from "@/components/ui";
import { PixCodeBlock } from "@/components/expenses/pix-pay-card";
import { formatBRL } from "@/lib/money";
import { todayISO } from "@/lib/ui/dates";
import { dueShort, installmentLabel } from "@/lib/ui/due-dates";
import {
	accountsLabel,
	failReasonText,
	itemKey,
	payAllPayload,
	pixIsCurrent,
	selectedItems,
	selectedTotal,
	selectionLabel,
	type FailReason,
	type PayableItem,
	type PayableRecipient,
} from "@/lib/ui/pay-all";
import { RECURRING_CHIP } from "@/lib/ui/recurrences";

/** O que cada cartão guarda: o que foi desmarcado e, se já gerou, o Pix (para qual valor, QR aberto, cópia que falhou). */
export type CardState = { unchecked: string[]; pixCents: number | null; qrOpen: boolean; codeFallback: boolean };
export const EMPTY_CARD: CardState = { unchecked: [], pixCents: null, qrOpen: false, codeFallback: false };

/** Um pagamento feito nesta tela: vira o cartão verde "Pago!". */
export type DoneBatch = {
	id: string;
	payeeName: string;
	paidCents: number;
	paidItems: PayableItem[];
	failed: { item: PayableItem; reason: FailReason }[];
	hasReceipt: boolean;
};

export type PayAllPageState =
	| { kind: "loading" }
	| { kind: "error"; message: string }
	| { kind: "unavailable" }
	| { kind: "ready"; recipients: PayableRecipient[]; done: DoneBatch[] };

/** Uma conta da lista: caixa para marcar, o que é, de quem é a parte, vencimento e valor. */
function ItemRow({ item, checked, onToggle, today }: Readonly<{ item: PayableItem; checked: boolean; onToggle: () => void; today: string }>) {
	const due = dueShort(item.dueDate, item.overdue, today);
	const chips = [
		!item.isYou && { tone: "wait" as const, text: `Parte de ${item.shareName}` },
		item.installment && { tone: "neutral" as const, text: installmentLabel(item.installment) },
		item.recurrence && { tone: "neutral" as const, text: RECURRING_CHIP },
	].filter((c): c is { tone: "wait" | "neutral"; text: string } => !!c);
	return (
		<li>
			<label className="flex min-h-14 cursor-pointer items-start gap-3 py-3">
				<input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 size-6 shrink-0 cursor-pointer accent-primary" />
				<span className={`min-w-0 flex-1 ${checked ? "" : "opacity-60"}`}>
					<span className="block break-words text-body-large font-medium text-on-surface">{item.description}</span>
					{item.groupName && <span className="block break-words text-sm text-on-surface-variant">{item.groupName}</span>}
					{due && (
						<span className={`block text-sm ${due.overdue ? "font-medium text-error" : "text-on-surface-variant"}`}>{due.text}</span>
					)}
					{chips.length > 0 && (
						<span className="mt-1.5 flex flex-wrap gap-1.5">
							{chips.map((c) => (
								<StatusChip key={c.text} tone={c.tone}>
									{c.text}
								</StatusChip>
							))}
						</span>
					)}
				</span>
				<span className={`money shrink-0 text-title-medium ${checked ? "text-on-surface" : "text-on-surface-variant line-through"}`}>{formatBRL(item.dueCents)}</span>
			</label>
		</li>
	);
}

/** Cartão de quem recebe: o que está incluído, o total marcado, o Pix e "Já paguei tudo". */
export function RecipientCardView({
	recipient,
	card,
	onToggleItem,
	onGenerate,
	onToggleQr,
	onCopyCode,
	onCopyKey,
	onPaid,
}: Readonly<{
	recipient: PayableRecipient;
	card: CardState;
	onToggleItem: (key: string) => void;
	onGenerate: () => void;
	onToggleQr: () => void;
	onCopyCode: () => void;
	onCopyKey: () => void;
	onPaid: () => void;
}>) {
	const today = todayISO();
	const headingId = `para-${recipient.id}`;
	const chosen = selectedItems(recipient.items, card.unchecked);
	const total = selectedTotal(recipient.items, card.unchecked);
	const none = chosen.length === 0;
	const pixShown = pixIsCurrent(card.pixCents, total);
	return (
		<Card as="section" tone="high" aria-labelledby={headingId} className="space-y-5 p-5 md:p-6">
			<div>
				<div className="flex items-center gap-3">
					<Avatar name={recipient.payee.name} src={recipient.payee.picture} managed={recipient.payee.kind === "managed"} />
					<h2 id={headingId} className="min-w-0 break-words text-title-large">
						Para {recipient.payee.name}
					</h2>
				</div>
				<p className="money mt-3 text-display-small font-bold text-error">{formatBRL(total)}</p>
				<p className="text-body-large text-on-surface-variant">{selectionLabel(chosen.length, recipient.items.length)}</p>
			</div>

			<div>
				<p className="mb-1 text-body-large text-on-surface-variant">Marque o que você vai pagar agora:</p>
				<ul className="divide-y divide-outline-variant/60 rounded-shape-md bg-surface-container-low px-3">
					{recipient.items.map((i) => (
						<ItemRow key={itemKey(i)} item={i} checked={!card.unchecked.includes(itemKey(i))} onToggle={() => onToggleItem(itemKey(i))} today={today} />
					))}
				</ul>
			</div>

			{none && (
				<p role="status" className="text-body-large text-on-surface-variant">
					Marque pelo menos uma conta para continuar.
				</p>
			)}

			{pixShown ? (
				<div className="space-y-5 border-t border-outline-variant pt-5">
					<p className="text-title-medium">
						Valor do Pix: <span className="money font-bold">{formatBRL(total)}</span>
					</p>
					<PixCodeBlock
						amountCents={total}
						payeeName={recipient.pix.payeeName}
						pix={recipient.pix}
						payload={payAllPayload(recipient, total)}
						qrOpen={card.qrOpen}
						codeFallback={card.codeFallback}
						onToggleQr={onToggleQr}
						onCopyCode={onCopyCode}
						onCopyKey={onCopyKey}
					/>
					<div className="space-y-2 border-t border-outline-variant pt-4">
						<p className="text-body-large text-on-surface-variant">Depois de pagar, avise aqui. Um comprovante só vale para as {chosen.length} contas.</p>
						<Button icon="check" fullWidth onClick={onPaid}>
							Já paguei tudo
						</Button>
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<Button icon="qr_code" fullWidth disabled={none} onClick={onGenerate}>
						{none ? "Gerar Pix" : `Gerar Pix de ${formatBRL(total)}`}
					</Button>
					<Button variant="outlined" icon="check" fullWidth disabled={none} onClick={onPaid}>
						Já paguei tudo
					</Button>
				</div>
			)}
		</Card>
	);
}

/** Depois de pagar: "Pago! R$ 350,00 para Maria, 3 contas", avisar no WhatsApp e, se alguma ficou de fora, quais e por quê. */
export function DoneCardView({ done, onTell }: Readonly<{ done: DoneBatch; onTell: () => void }>) {
	const paidCount = done.paidItems.length;
	const headingId = `pago-${done.id}`;
	const nothing = paidCount === 0;
	return (
		<Card as="section" tone="high" aria-labelledby={headingId} className="overflow-hidden">
			<div
				className={`flex items-start gap-3 p-5 ${nothing ? "bg-error-container text-on-error-container" : "bg-primary-container text-on-primary-container"}`}
			>
				<span
					className={`flex size-10 shrink-0 items-center justify-center rounded-full ${nothing ? "bg-error text-on-error" : "bg-primary text-on-primary"}`}
				>
					<Icon name={nothing ? "warning" : "check"} />
				</span>
				<div className="min-w-0">
					{nothing ? (
						<h2 id={headingId} className="text-title-large">
							Nenhuma conta foi marcada
						</h2>
					) : (
						<>
							<h2 id={headingId} className="text-title-large">
								Pago!
							</h2>
							<p className="text-body-large">
								<span className="money font-bold">{formatBRL(done.paidCents)}</span> para {done.payeeName}, {accountsLabel(paidCount)}.
							</p>
							<p className="text-body-large">{done.hasReceipt ? "O comprovante vale para todas as contas." : "Avisado sem comprovante."}</p>
						</>
					)}
				</div>
			</div>
			<div className="space-y-4 p-5">
				{done.failed.length > 0 && (
					<Banner tone="attention" icon="warning" title={nothing ? "Ninguém foi marcado como pago:" : "Estas contas não foram marcadas:"}>
						<ul className="mt-1 space-y-1">
							{done.failed.map(({ item, reason }) => (
								<li key={itemKey(item)} className="break-words">
									<span className="font-medium">{item.description}</span>
									{!item.isYou && ` (parte de ${item.shareName})`}: {failReasonText(reason)}.
								</li>
							))}
						</ul>
						{reasonHint(done.failed.map((f) => f.reason))}
					</Banner>
				)}
				{!nothing && (
					<Button icon="share" fullWidth onClick={onTell}>
						Avisar no WhatsApp
					</Button>
				)}
			</div>
		</Card>
	);
}

function reasonHint(reasons: FailReason[]) {
	if (!reasons.includes("conflict")) return null;
	return <p className="mt-2">As que mudaram continuam na lista abaixo, com o valor de agora.</p>;
}

export function PayAllSkeleton() {
	return (
		<div role="status" className="mx-auto max-w-2xl space-y-4">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-6 w-2/3" />
			<Skeleton className="h-72 rounded-shape-lg" />
			<Skeleton className="h-72 rounded-shape-lg" />
		</div>
	);
}

/** A tela "Pagar tudo": um cartão por pessoa que recebe, ou o estado de carregando, erro ou vazio. */
export function PayAllView({
	state,
	cards,
	onToggleItem,
	onGenerate,
	onToggleQr,
	onCopyCode,
	onCopyKey,
	onPaid,
	onTell,
	onRetry,
}: Readonly<{
	state: PayAllPageState;
	cards: Record<string, CardState>;
	onToggleItem: (recipientId: string, key: string) => void;
	onGenerate: (recipientId: string) => void;
	onToggleQr: (recipientId: string) => void;
	onCopyCode: (recipientId: string) => void;
	onCopyKey: (recipientId: string) => void;
	onPaid: (recipientId: string) => void;
	onTell: (batchId: string) => void;
	onRetry: () => void;
}>) {
	if (state.kind === "loading") return <PayAllSkeleton />;
	if (state.kind === "error") {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title="Ops!"
				action={
					<>
						<Button icon="refresh" onClick={onRetry}>
							Tentar de novo
						</Button>
						<Button href="/app" variant="outlined">
							Voltar para o início
						</Button>
					</>
				}
			>
				{state.message}
			</EmptyState>
		);
	}
	if (state.kind === "unavailable") {
		return (
			<EmptyState icon="refresh" title="Ainda não está disponível" action={<Button href="/app">Voltar para o início</Button>}>
				Esta função ainda não está disponível. Tente de novo mais tarde.
			</EmptyState>
		);
	}
	const { recipients, done } = state;
	if (recipients.length === 0 && done.length === 0) {
		return (
			<EmptyState icon="check" title="Você não tem nada para pagar agora." action={<Button href="/app">Voltar para o início</Button>}>
				Quando surgir uma conta para pagar neste mês, ela aparece aqui.
			</EmptyState>
		);
	}
	return (
		<div className="mx-auto max-w-2xl space-y-5">
			{recipients.length > 1 && <p className="text-body-large text-on-surface-variant">Cada pessoa recebe um Pix separado.</p>}
			{done.map((d) => (
				<DoneCardView key={d.id} done={d} onTell={() => onTell(d.id)} />
			))}
			{recipients.map((r) => (
				<RecipientCardView
					key={r.id}
					recipient={r}
					card={cards[r.id] ?? EMPTY_CARD}
					onToggleItem={(k) => onToggleItem(r.id, k)}
					onGenerate={() => onGenerate(r.id)}
					onToggleQr={() => onToggleQr(r.id)}
					onCopyCode={() => onCopyCode(r.id)}
					onCopyKey={() => onCopyKey(r.id)}
					onPaid={() => onPaid(r.id)}
				/>
			))}
			{recipients.length === 0 && (
				<Button href="/app" variant="outlined" fullWidth>
					Voltar para o início
				</Button>
			)}
		</div>
	);
}
