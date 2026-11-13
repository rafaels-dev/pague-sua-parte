"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ActionChip, Avatar, Banner, Button, Card, EmptyState, Icon, List, MoneyField, Sheet, Skeleton, Snackbar, StatusChip } from "@/components/ui";
import type { Group } from "@/components/groups/group-detail";
import { NotMemberState } from "@/components/groups/not-member";
import { useShareInvite } from "@/components/groups/use-share-invite";
import { expenseShareCarriesInvite, expenseShareLink, SOLO_SHARE_EXPENSE_HINT, SOLO_SHARE_NOTICE } from "@/lib/ui/share-link";
import { normalizeGroupDetail } from "@/components/groups/types";
import { apiFetch, apiFetchBlob, ApiError, isMissingExpenseError, isNotMemberError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { buildPixPayload, descriptionBudget } from "@/lib/pix/brcode";
import { refundMessage, shareMessage } from "@/lib/pix/message";
import { copyText } from "@/lib/ui/clipboard";
import { formatDateLong, formatDateShort, todayISO } from "@/lib/ui/dates";
import { deleteFlashMessage, dueLong, installmentLabel } from "@/lib/ui/due-dates";
import { RECURRING_CHIP } from "@/lib/ui/recurrences";
import { isImageType } from "@/lib/ui/attachments";
import { cashbackDetailLine } from "@/lib/ui/cashback";
import { installmentShareInfo } from "@/lib/ui/installment-share";
import { ADVANCE_LINK, advanceDoneMessage, advancePayload, type AdvanceDoneData, type AdvancePlanData } from "@/lib/ui/advance";
import { ADVANCE_UNCERTAIN, buildAdvanceShareText } from "@/lib/payments/advance";
import { buildExpenseShareText, buildPaidShareText, shareIntro } from "@/lib/ui/expense-share";
import { paidByLabel, shareStatusChip } from "@/lib/ui/expense-status";
import { buildExpenseStatusText, buildRefundShareText, expenseSummaryIntro } from "@/lib/ui/expense-summary";
import { paidCaption, receiptActions, receiptDoneMessage, receiptSheetCopy, refundCaption, undoLabel, type ReceiptMode } from "@/lib/ui/receipts";
import { managedCaption } from "@/lib/ui/managed";
import { amountHint, checkAmount, isPartial, paidNoticeAmount, partLine, partialLine, undoPartCentsOf } from "@/lib/ui/partial-pay";
import { batchCaption } from "@/lib/ui/pay-all";
import { HelpCard, HelpContent, canHelpOn, helperOptions } from "./help";
import { ExpenseAttachments, type AttachmentView } from "./expense-attachments";
import { DeleteInstallmentContent, ResplitScopeContent, type InstallmentScope } from "./installment-scope";
import { InstallmentsSection } from "./installments-section";
import { ShareExpenseContent } from "./expense-share";
import { AdvanceContent } from "./advance-sheet";
import { OtherAmountContent } from "./other-amount";
import { openBlobInNewTab } from "./open-blob";
import { ReceiptSheetBody } from "./receipt-sheet";
import { AccountHeader, PixCodeBlock, PixPayCard } from "./pix-pay-card";
import { ResplitContent } from "./resplit-sheet";
import { clearFlash, keyToCopy, normalizeExpense, peekFlash, setFlash, type ExpenseDetailData, type ExpenseShare } from "./types";
import { modeFor, type SplitMember, type SplitMode } from "./who-splits";

export const LAUNCHED_FLASH = "Despesa lançada!";

/** "Copia e Cola" da devolução a `share` (para a chave Pix de quem recebe de volta); null se não dá para gerar. */
export function refundPayload(expense: ExpenseDetailData, share: ExpenseShare): string | null {
	if (!share.refundPix) return null;
	try {
		return buildPixPayload({ key: share.refundPix.key, payeeName: share.refundPix.payeeName, amountCents: share.refundCents, description: refundMessage(expense.description, expense.installment, descriptionBudget(share.refundPix.key)) });
	} catch {
		return null;
	}
}

/** Código "Copia e Cola" da parte de quem deve, ou null se os dados não permitem gerar. */
export function payloadFor(expense: ExpenseDetailData, shareCents: number): string | null {
	if (!expense.pix) return null;
	try {
		return buildPixPayload({ key: expense.pix.key, payeeName: expense.pix.payeeName, amountCents: shareCents, description: shareMessage(expense.description, expense.installment, descriptionBudget(expense.pix.key)) });
	} catch {
		return null;
	}
}

/** "Hoje", "Ontem" ou "12 nov": a data (no fuso de São Paulo) em que a parte foi marcada como paga. */
export function paidDateLabel(paidAt: string | null): string {
	if (!paidAt) return "";
	const t = new Date(paidAt);
	return Number.isNaN(t.getTime()) ? "" : formatDateShort(todayISO(t));
}

/** Linha de uma pessoa em "Quem participa". As ações do dono (pago, devolvi, desfazer) ficam junto do selo, embaixo do nome (cabe em 390px). */
function ShareRow({
	share: s,
	canMarkPaid,
	onMarkPaid,
	onUndoPaid,
	onGiveBack,
	onViewReceipt,
	onAttachReceipt,
	onViewRefundReceipt,
	onViewPartReceipt,
}: Readonly<{
	share: ExpenseShare;
	canMarkPaid: boolean;
	onViewRefundReceipt: (uid: string) => void;
	onViewPartReceipt: (uid: string, partId: string) => void;
	onMarkPaid: (uid: string) => void;
	onUndoPaid: (uid: string) => void;
	onGiveBack: (uid: string) => void;
	onViewReceipt: (uid: string) => void;
	onAttachReceipt: (uid: string) => void;
}>) {
	const chip = shareStatusChip(s.status, s);
	const canAct = canMarkPaid && s.status !== "payer";
	const refundNote = s.refund ? refundCaption(s.refund, paidDateLabel(s.refund.at), formatBRL) : null;
	const when = paidDateLabel(s.paidAt);
	const caption = managedCaption(s);
	const receiptAct = receiptActions(s);
	const paidNote = paidCaption(s, when);
	const partial = isPartial(s);
	// Desfazer: o dono/administrador desfaz o pagamento (ou o último parcial); quem avisou um parcial desfaz o seu.
	const undoPaidBtn = canAct && s.status === "paid" && !s.refund;
	const undoPartBtn = !undoPaidBtn && s.status !== "refund" && (s.canUndoOwnPart || (canAct && s.status === "pending" && s.parts.length > 0));
	return (
		<li className="px-4 py-3 text-on-surface">
			<div className="flex min-h-12 items-center gap-4">
				<Avatar name={s.name} src={s.picture} managed={s.kind === "managed"} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-3">
						<span className="min-w-0 break-words text-body-large font-medium">
							{s.name}
							{s.isYou && <span className="font-normal text-on-surface-variant"> (você)</span>}
							{caption && <span className="block text-sm font-normal text-on-surface-variant">{caption}</span>}
						</span>
						{s.participates && <span className="money shrink-0 text-title-medium">{formatBRL(s.amountCents)}</span>}
					</div>
					<span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
						<StatusChip tone={chip.tone}>{chip.text}</StatusChip>
						{s.helped && s.participates && (
							<StatusChip tone="ok">
								<Icon name="favorite" size={14} className="mr-1" />
								Ajudou
							</StatusChip>
						)}
						{canAct && s.status === "pending" && (
							<ActionChip icon="check" onClick={() => onMarkPaid(s.uid)}>
								Marcar como pago
							</ActionChip>
						)}
						{s.canRefund && (
							<ActionChip icon="check" onClick={() => onGiveBack(s.uid)}>
								Devolvi
							</ActionChip>
						)}
						{s.refund && s.participates && (
							<StatusChip tone="ok">
								<Icon name="check" size={14} className="mr-1" />
								Devolvido
							</StatusChip>
						)}
						{s.refund?.receipt && (
							<ActionChip icon="receipt_long" tone="tonal" onClick={() => onViewRefundReceipt(s.uid)}>
								Ver comprovante da devolução
							</ActionChip>
						)}
						{s.canUndoRefund && <ActionChip onClick={() => onUndoPaid(s.uid)}>Desfazer devolução</ActionChip>}
						{receiptAct.view && (
							<ActionChip icon="receipt_long" tone="tonal" onClick={() => onViewReceipt(s.uid)}>
								Ver comprovante
							</ActionChip>
						)}
						{receiptAct.attach && (
							<ActionChip icon="receipt_long" onClick={() => onAttachReceipt(s.uid)}>
								Anexar comprovante
							</ActionChip>
						)}
						{undoPaidBtn && <ActionChip onClick={() => onUndoPaid(s.uid)}>{undoLabel(s, "owner")}</ActionChip>}
						{undoPartBtn && <ActionChip onClick={() => onUndoPaid(s.uid)}>{undoLabel(s, canAct ? "owner" : "debtor")}</ActionChip>}
					</span>
				</div>
			</div>
			{partial && <p className="ml-16 mt-1 text-sm font-medium text-on-surface">{partialLine(s.paidCents, s.dueCents)}</p>}
			{s.parts.length > 0 && (
				<ul className="ml-16 mt-1 space-y-1 text-sm text-on-surface-variant" aria-label={`Pagamentos de ${s.name}`}>
					{s.parts.map((p) => (
						<li key={p.id}>
							{partLine(p, p.at ? paidDateLabel(p.at) : "data não registrada")}
							{p.receipt && (
								<>
									{" · "}
									<button type="button" onClick={() => onViewPartReceipt(s.uid, p.id)} className="rounded-sm text-primary underline underline-offset-2">
										Ver comprovante
									</button>
								</>
							)}
						</li>
					))}
				</ul>
			)}
			{refundNote && <p className="ml-16 mt-1 text-sm text-on-surface-variant">{refundNote}</p>}
			{paidNote && (
				<p className="ml-16 mt-1 text-sm text-on-surface-variant">
					{paidNote}
					{receiptAct.replace && (
						<>
							{" · "}
							<button type="button" onClick={() => onAttachReceipt(s.uid)} className="rounded-sm text-primary underline underline-offset-2">
								Trocar comprovante
							</button>
						</>
					)}
				</p>
			)}
			{!paidNote && receiptAct.replace && (
				<p className="ml-16 mt-1 text-sm">
					<button type="button" onClick={() => onAttachReceipt(s.uid)} className="rounded-sm text-primary underline underline-offset-2">
						Trocar comprovante
					</button>
				</p>
			)}
		</li>
	);
}

/**
 * O que se vê sobre uma parte que não precisa mais de pagamento: a receber de volta ou tudo pago.
 * `account` (nome) liga a faixa "Sua parte" / "Parte de <nome> (você cuida)"; `managed` = parte de pessoa sem celular.
 */
function PartStatusCard({
	share,
	ownerName,
	labeled,
	headingId,
	onViewReceipt,
	onAttachReceipt,
	onTell,
}: Readonly<{
	share: ExpenseShare;
	ownerName: string;
	labeled: boolean;
	headingId: string;
	onViewReceipt: (uid: string) => void;
	onAttachReceipt: (uid: string) => void;
	/** Abre o aviso de pagamento para mandar no WhatsApp. */
	onTell: (uid: string) => void;
}>) {
	const refund = share.status === "refund";
	const act = receiptActions(share);
	const managed = share.youManage;
	const who = managed ? share.name : "Você";
	const told = share.method === "self";
	const joint = batchCaption(share.batch);
	const title = refund
		? "A receber de volta"
		: told
			? managed
				? "Aviso de pagamento enviado"
				: "Você avisou que pagou"
			: managed
				? "Parte paga"
				: "Sua parte está paga";
	return (
		<Card as="section" tone="high" aria-labelledby={headingId} className="overflow-hidden">
			{labeled && <AccountHeader id={headingId} name={share.name} managed={managed} />}
			<div className="flex items-start gap-3 bg-primary-container p-5 text-on-primary-container">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
					<Icon name="check" />
				</span>
				<div className="min-w-0">
					{labeled ? (
						<p className="text-title-large">{title}</p>
					) : (
						<h2 id={headingId} className="text-title-large">
							{title}
						</h2>
					)}
					{refund && (
						<p className="text-body-large">
							{who} pagou {formatBRL(share.refundCents)} a mais. {ownerName} vai devolver.
						</p>
					)}
					{!refund && joint && <p className="text-body-large">{joint}.</p>}
				</div>
			</div>
			{/* Comprovante da parte paga: anexar, ver ou trocar, e avisar quem recebeu. */}
			{!refund && (act.view || act.attach || act.replace) && (
				<div className="space-y-3 p-5">
					<p className="text-body-large text-on-surface-variant">
						{act.view ? `${ownerName} consegue ver o comprovante que você enviou.` : `Você ainda não enviou o comprovante. Com ele, ${ownerName} confirma que recebeu.`}
					</p>
					<div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
						{act.attach && (
							<Button icon="attach_file" onClick={() => onAttachReceipt(share.uid)} fullWidth className="md:w-auto">
								Anexar comprovante
							</Button>
						)}
						{act.view && (
							<Button variant="tonal" icon="receipt_long" onClick={() => onViewReceipt(share.uid)} fullWidth className="md:w-auto">
								Ver comprovante
							</Button>
						)}
						{act.replace && (
							<Button variant="outlined" icon="attach_file" onClick={() => onAttachReceipt(share.uid)} fullWidth className="md:w-auto">
								Trocar comprovante
							</Button>
						)}
						<Button variant="text" icon="share" onClick={() => onTell(share.uid)} fullWidth className="md:w-auto">
							Avisar novamente
						</Button>
					</div>
				</div>
			)}
		</Card>
	);
}

export function ExpenseDetailView({
	expense,
	attachments,
	qrOpen,
	codeFallback,
	onToggleQr,
	onCopyCode,
	onCopyKey,
	onOpenImage,
	onOpenPdf,
	onAskDelete,
	onMarkPaid,
	onUndoPaid,
	onGiveBack,
	onEditParticipants,
	onShare,
	onHelp,
	onPaid,
	onViewReceipt,
	onAttachReceipt,
	onTellPaid,
	onEdit,
	onShareSummary,
	onViewRefundReceipt = () => {},
	onViewPartReceipt = () => {},
	onOtherAmount,
}: Readonly<{
	/** Abre "Pagar outro valor" da parte de alguém que você paga. */
	onOtherAmount?: (uid: string) => void;
	/** Abre o comprovante de um pagamento parcial de uma parte. */
	onViewPartReceipt?: (uid: string, partId: string) => void;
	expense: ExpenseDetailData;
	/** Abre a edição da despesa (quem pagou ou o administrador do grupo). */
	onEdit?: () => void;
	/** Abre o sheet "Compartilhar resumo" desta despesa (WhatsApp). */
	onShareSummary?: () => void;
	/** Abre o comprovante da devolução de uma parte. */
	onViewRefundReceipt?: (uid: string) => void;
	attachments: AttachmentView[];
	/** Parte (uid) cujo QR Code está aberto. */
	qrOpen: string | null;
	/** Parte (uid) cujo código não pôde ser copiado sozinho. */
	codeFallback: string | null;
	onToggleQr: (uid: string) => void;
	onCopyCode: (uid: string) => void;
	onCopyKey: (refundUid?: string) => void;
	onOpenImage: (id: string) => void;
	onOpenPdf: (id: string) => void;
	onAskDelete: () => void;
	/** Dono da despesa pede para marcar a parte de alguém como paga (abre a confirmação). */
	onMarkPaid: (uid: string) => void;
	/** Dono da despesa pede para desfazer o pagamento de alguém (abre a confirmação). */
	onUndoPaid: (uid: string) => void;
	/** Dono da despesa pede para marcar que devolveu o dinheiro a alguém (abre a confirmação). */
	onGiveBack: (uid: string) => void;
	/** Dono abre "Mudar quem divide". */
	onEditParticipants: () => void;
	/** Abre o sheet de avisar o grupo (WhatsApp). */
	onShare: () => void;
	/** Abre o sheet "Quero ajudar". */
	onHelp: () => void;
	/** Abre o sheet "Já paguei" da parte de alguém que você paga. */
	onPaid: (uid: string) => void;
	/** Abre o comprovante de uma parte. */
	onViewReceipt: (uid: string) => void;
	/** Abre o sheet "Anexar comprovante" de uma parte já paga. */
	onAttachReceipt: (uid: string) => void;
	/** Abre o aviso "paguei minha parte" para mandar no WhatsApp. */
	onTellPaid: (uid: string) => void;
}>) {
	// Contas que a pessoa controla nesta despesa: a dela e as das pessoas sem celular que ela cuida (a dela primeiro).
	const accounts = expense.shares
		.filter((s) => (s.isYou || s.youManage) && s.status !== "payer")
		.sort((a, b) => Number(b.isYou) - Number(a.isYou));
	const pix = expense.pix;
	const today = todayISO();
	const due = dueLong(expense.dueDate, expense.overdue, today);
	const labeled = expense.shares.some((s) => s.youManage) || expense.paidBy.youManage;
	const youPaid = expense.paidBy.isYou || expense.paidBy.youManage;
	const payerManaged = expense.paidBy.youManage;
	const payerName = expense.paidBy.name;
	// Devoluções que você paga (quem pagou a despesa ou age por ele): cada uma com o Pix de quem recebe de volta.
	const refundPayers = expense.shares.filter((s) => s.status === "refund" && s.refundPix !== undefined && s.canRefund);
	const stillOwe = expense.shares.filter((s) => s.status === "pending");
	const toReturn = expense.shares.filter((s) => s.status === "refund");
	const allPaid = stillOwe.length === 0 && toReturn.length === 0;
	const inSplit = expense.shares.filter((s) => s.participates);
	const left = expense.shares.filter((s) => !s.participates);
	const row = (s: ExpenseShare) => (
		<ShareRow
			key={s.uid}
			share={s}
			canMarkPaid={expense.canMarkPaid}
			onMarkPaid={onMarkPaid}
			onUndoPaid={onUndoPaid}
			onGiveBack={onGiveBack}
			onViewReceipt={onViewReceipt}
			onAttachReceipt={onAttachReceipt}
				onViewRefundReceipt={onViewRefundReceipt}
			onViewPartReceipt={onViewPartReceipt}
		/>
	);

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<header className="space-y-1">
				{(expense.installment || expense.recurrence) && (
					<p className="flex flex-wrap gap-2 pb-1">
						{expense.installment && <StatusChip tone="neutral">{installmentLabel(expense.installment)}</StatusChip>}
						{expense.recurrence && <StatusChip tone="neutral">{RECURRING_CHIP}</StatusChip>}
					</p>
				)}
				<h1 className="break-words text-headline-medium md:text-headline-large">{expense.description}</h1>
				<p className="money text-display-small font-bold">{formatBRL(expense.amountCents)}</p>
				{(expense.cashbackCents ?? 0) > 0 && <p className="text-body-large text-on-surface-variant">{cashbackDetailLine(expense.amountCents, expense.cashbackCents ?? 0, !!expense.installment)}</p>}
				<p className="text-body-large text-on-surface-variant">
					{paidByLabel(expense.paidBy)} · {formatDateLong(expense.date)}
				</p>
				{expense.planId && (
					<p>
						<Button href={`/app/planos/${encodeURIComponent(expense.planId)}`} variant="text" size="md" icon="calendar_today" className="-ml-4">
							Ver o plano
						</Button>
					</p>
				)}
				{expense.launchedBy && (
					<p className="text-body-medium text-on-surface-variant">
						Lançada por {expense.launchedBy.name}
						{expense.launchedBy.admin ? " (administrador)" : ""}
					</p>
				)}
				{due && (
					<p className={`flex items-center gap-2 text-title-medium ${due.overdue ? "text-error" : "text-on-surface"}`}>
						<Icon name={due.overdue ? "warning" : "calendar_today"} size={22} />
						{due.text}
					</p>
				)}
				<div className="flex flex-wrap gap-x-2">
					<Button variant="text" size="md" icon="share" onClick={onShare} className="-ml-4">
						Cobrar no WhatsApp
					</Button>
					{onShareSummary && (
						<Button variant="text" size="md" icon="description" onClick={onShareSummary}>
							Compartilhar resumo
						</Button>
					)}
				</div>
			</header>

			{expense.adminOnly && (
				<Card tone="high" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3" aria-label="Administrador do grupo">
					<p className="flex min-w-0 items-center gap-2 text-body-large text-on-surface-variant">
						<Icon name="person" size={20} />
						Você é administrador do grupo
					</p>
					{expense.canEdit && onEdit && (
						<Button variant="text" size="md" icon="edit" onClick={onEdit} className="-mr-3">
							Editar despesa
						</Button>
					)}
				</Card>
			)}
			{!expense.adminOnly && expense.canEdit && onEdit && (
				<Button variant="text" size="md" icon="edit" onClick={onEdit} className="-ml-4">
					Editar despesa
				</Button>
			)}

			{canHelpOn(expense) && <HelpCard expense={expense} onHelp={onHelp} />}

			{!pix && accounts.some((s) => s.status === "pending") && (
				<Banner title={`${payerName} ainda não cadastrou a chave Pix`} icon="warning" role="status">
					Por enquanto não há Pix pelo app. Se pagar de outro jeito, use &ldquo;Já paguei&rdquo;. Quando a chave for cadastrada, o Pix aparece nesta tela.
				</Banner>
			)}
			{accounts.map((s) => {
				const headingId = `conta-${s.uid}`;
				if (s.status === "pending") {
					return (
						<PixPayCard
							key={s.uid}
							headingId={headingId}
							due={due}
							accountName={labeled ? s.name : undefined}
							managed={s.youManage}
							shareCents={s.dueCents}
							paidSoFarCents={s.paidCents}
							payeeName={pix?.payeeName ?? payerName}
							pix={pix}
							payload={payloadFor(expense, s.dueCents)}
							qrOpen={qrOpen === s.uid}
							codeFallback={codeFallback === s.uid}
							onToggleQr={() => onToggleQr(s.uid)}
							onCopyCode={() => onCopyCode(s.uid)}
							onCopyKey={onCopyKey}
							canPay={s.canPay}
							onPaid={() => onPaid(s.uid)}
							onOtherAmount={onOtherAmount && (s.dueCents > 1 || expense.installment) ? () => onOtherAmount(s.uid) : undefined}
							otherLabel={expense.installment ? ADVANCE_LINK : undefined}
						/>
					);
				}
				if (s.status === "refund" || (s.status === "paid" && s.participates)) {
					return (
						<PartStatusCard
							key={s.uid}
							share={s}
							ownerName={payerName}
							labeled={labeled}
							headingId={headingId}
							onViewReceipt={onViewReceipt}
							onAttachReceipt={onAttachReceipt}
							onTell={onTellPaid}
						/>
					);
				}
				return null;
			})}

			{refundPayers.map((s) => (
				<Card key={s.uid} as="section" tone="high" aria-labelledby={`devolver-${s.uid}`} className="overflow-hidden">
					<div className="space-y-5 p-5 md:p-6">
						<div>
							<p id={`devolver-${s.uid}`} className="text-title-large text-on-surface-variant">
								Devolver para {s.name}
							</p>
							<p className="money text-display-small font-bold text-error">{formatBRL(s.refundCents)}</p>
							<p className="text-body-large text-on-surface-variant">
								{s.name} pagou a mais nesta despesa{payerManaged ? ` e ${payerName} vai devolver` : ""}.
							</p>
						</div>
						{s.refundPix ? (
							<PixCodeBlock
								amountCents={s.refundCents}
								payeeName={s.refundPix.payeeName}
								pix={s.refundPix}
								payload={refundPayload(expense, s)}
								qrOpen={qrOpen === `r:${s.uid}`}
								codeFallback={codeFallback === `r:${s.uid}`}
								onToggleQr={() => onToggleQr(`r:${s.uid}`)}
								onCopyCode={() => onCopyCode(`r:${s.uid}`)}
								onCopyKey={() => onCopyKey(`r:${s.uid}`)}
							/>
						) : (
							<Banner tone="attention" icon="warning" role="status">
								{s.managedByName
									? `${s.name} não tem chave Pix cadastrada. Peça para ${s.managedByName} cadastrar a chave no grupo, ou devolva de outro jeito.`
									: `${s.name} ainda não cadastrou a chave Pix. Devolva de outro jeito (dinheiro ou outra chave combinada).`}
							</Banner>
						)}
						<div className="space-y-2 border-t border-outline-variant pt-4">
							<p className="text-body-large text-on-surface-variant">Depois de devolver, avise aqui. Dá para enviar o comprovante.</p>
							<Button variant="tonal" icon="check" fullWidth onClick={() => onGiveBack(s.uid)}>
								Devolvi
							</Button>
						</div>
					</div>
				</Card>
			))}

			{youPaid && (
				<Card
					as="section"
					tone="high"
					aria-labelledby="voce-pagou"
					className={`space-y-3 p-5 ${allPaid ? "bg-primary-container! text-on-primary-container" : ""}`}
				>
					<div className="flex items-center gap-3">
						{payerManaged ? (
							<Avatar name={payerName} managed />
						) : (
							<span
								className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
									allPaid ? "bg-primary text-on-primary" : "bg-primary-container text-on-primary-container"
								}`}
							>
								<Icon name="check" />
							</span>
						)}
						<h2 id="voce-pagou" className="text-title-large">
							{payerManaged ? (
								<>
									{payerName} pagou esta despesa <span className="whitespace-nowrap font-normal">· você cuida</span>
								</>
							) : allPaid ? (
								"Tudo certo"
							) : (
								"Você pagou esta despesa"
							)}
						</h2>
					</div>
					{stillOwe.length > 0 && (
						<div>
							<p className="mb-1 text-body-large text-on-surface-variant">{payerManaged ? `${payerName} ainda tem a receber de:` : "Ainda falta receber de:"}</p>
							<ul className="space-y-1">
								{stillOwe.map((s) => (
									<li key={s.uid} className="flex items-baseline justify-between gap-3 text-body-large">
										<span className="min-w-0 break-words font-medium">{s.name}</span>
										<span className="money shrink-0">{formatBRL(s.dueCents)}</span>
									</li>
								))}
							</ul>
						</div>
					)}
					{toReturn.length > 0 && (
						<div>
							<p className="mb-1 text-body-large text-on-surface-variant">{payerManaged ? `${payerName} precisa devolver para:` : "Você precisa devolver para:"}</p>
							<ul className="space-y-1">
								{toReturn.map((s) => (
									<li key={s.uid} className="flex items-baseline justify-between gap-3 text-body-large">
										<span className="min-w-0 break-words font-medium">{s.name}</span>
										<span className="money shrink-0">{formatBRL(s.refundCents)}</span>
									</li>
								))}
							</ul>
						</div>
					)}
					{allPaid && <p className="text-body-large">Todo mundo pagou e não há nada a devolver.</p>}
				</Card>
			)}

			{expense.installment && expense.series && (
				<InstallmentsSection groupId={expense.groupId} currentId={expense.id} series={expense.series} today={today} />
			)}

			<section className="space-y-3" aria-labelledby="quem-participa">
				<div className="flex flex-wrap items-center justify-between gap-x-4">
					<h2 id="quem-participa" className="text-title-large">
						Quem participa
					</h2>
					{expense.canEditParticipants && (
						<Button variant="text" size="md" icon="group" onClick={onEditParticipants} className="-mr-4">
							Mudar quem divide
						</Button>
					)}
				</div>
				<List>{inSplit.map(row)}</List>
				{left.length > 0 && (
					<>
						<h3 className="pt-2 text-title-medium text-on-surface-variant">Saíram da divisão</h3>
						<List>{left.map(row)}</List>
					</>
				)}
			</section>

			<ExpenseAttachments items={attachments} onOpenImage={onOpenImage} onOpenPdf={onOpenPdf} />

			{expense.canDelete && (
				<div className="pt-2">
					<Button variant="text" size="md" icon="delete" onClick={onAskDelete} className="-ml-4 text-error!">
						{expense.installment ? "Apagar parcela" : "Apagar despesa"}
					</Button>
				</div>
			)}
		</div>
	);
}

export function ExpenseDetailSkeleton() {
	return (
		<div role="status" className="mx-auto max-w-2xl space-y-6">
			<span className="sr-only">Carregando...</span>
			<div className="space-y-2">
				<Skeleton className="h-9 w-2/3" />
				<Skeleton className="h-10 w-1/2" />
				<Skeleton className="h-6 w-3/4" />
			</div>
			<Skeleton className="h-64 rounded-shape-lg" />
			<Skeleton className="h-[4.5rem] rounded-shape-md" />
			<Skeleton className="h-[4.5rem] rounded-shape-md" />
		</div>
	);
}

/** Conteúdo (visual) do sheet de confirmação ao apagar. */
export function DeleteExpenseContent({
	busy,
	error,
	onConfirm,
	onCancel,
}: Readonly<{ busy: boolean; error: string | null; onConfirm: () => void; onCancel: () => void }>) {
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface">Isso apaga a despesa e os anexos para todo mundo do grupo. Não dá para desfazer.</p>
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button onClick={onConfirm} loading={busy} fullWidth className="bg-error! text-on-error!">
					{busy ? "Apagando..." : "Sim, apagar"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Cancelar
				</Button>
			</div>
		</div>
	);
}

/** Conteúdo (visual) do sheet de confirmação ao marcar uma parte como paga, ou ao desfazer. */
export function SharePaidContent({
	mode,
	selfReported = false,
	undoRefund = false,
	undoPartCents,
	dueCents = 0,
	busy,
	error,
	onConfirm,
	onCancel,
	initialPartial = false,
	onPartialChange,
	onAdvance,
}: Readonly<{
	/** Compra parcelada com parcelas seguintes em aberto: abre "Recebi um valor" que abate das próximas parcelas. */
	onAdvance?: () => void;
	/** Só para as telas de exemplo: "Recebi só uma parte" já aberto. */
	initialPartial?: boolean;
	/** Avisa quando "Recebi só uma parte" abre ou fecha (o título da folha muda). */
	onPartialChange?: (open: boolean) => void;
	/** Desfazer o último pagamento parcial (valor dele): a parte volta ao que era antes dele. */
	undoPartCents?: number;
	/** O que falta receber da parte (para "Recebi só uma parte"). */
	dueCents?: number;
	mode: "paid" | "pending" | "refund";
	/** A pessoa avisou que pagou: desfazer vira "Não recebi". */
	selfReported?: boolean;
		/** Desfazer uma devolução já marcada: o valor volta a ficar a receber de volta. */
		undoRefund?: boolean;
		busy: boolean;
	error: string | null;
	/** `amountCents` só vem em "Recebi só uma parte". */
	onConfirm: (amountCents?: number) => void;
	onCancel: () => void;
}>) {
	const marking = mode === "paid";
	const giving = mode === "refund";
	const [partialOpen, setPartialOpen] = useState(initialPartial);
	const [cents, setCents] = useState(0);
	const check = checkAmount(cents, dueCents);
	const partialValid = check.kind === "part" || check.kind === "full";
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">
				{undoPartCents
					? `O último pagamento (${formatBRL(undoPartCents)}) some e a parte volta ao que era antes dele.`
					: marking && partialOpen
						? "Digite quanto você recebeu. A parte continua em aberto com o que faltar."
						: giving
					? "Use quando você já devolveu o dinheiro, por Pix ou em dinheiro."
					: marking
						? "Use quando a pessoa pagou em dinheiro ou combinou de outra forma."
						: undoRefund
							? "A devolução e o comprovante dela somem, e o valor volta a ficar a receber de volta."
							: selfReported
							? "O aviso e o comprovante somem e a parte volta a ficar em aberto."
							: "A marcação some e a parte volta a ficar em aberto."}
			</p>
			{marking && dueCents > 1 && !partialOpen && (
				<button type="button" onClick={() => {
						setPartialOpen(true);
						onPartialChange?.(true);
					}}
					className="rounded-sm text-body-large text-primary underline underline-offset-2">
					Recebi só uma parte
				</button>
			)}
			{marking && onAdvance && !partialOpen && (
				<button type="button" onClick={onAdvance} className="block rounded-sm text-left text-body-large text-primary underline underline-offset-2">
					Recebi um valor que passa desta parcela
				</button>
			)}
			{marking && partialOpen && (
				<MoneyField id="recebi-valor" label="Valor que recebi" cents={cents} onChange={setCents} autoFocus error={check.kind === "too_much" ? check.message : null} supportingText={amountHint(check)} />
			)}
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button onClick={() => onConfirm(marking && partialOpen ? cents : undefined)} loading={busy} disabled={busy || (marking && partialOpen && !partialValid)} fullWidth>
					{giving
						? busy
							? "Salvando..."
							: "Sim, devolvi"
						: marking
							? busy
								? "Marcando..."
								: partialOpen
									? partialValid
										? `Sim, recebi ${formatBRL(cents)}`
										: "Sim, recebi"
									: "Sim, marcar como pago"
							: busy
								? "Desfazendo..."
								: undoRefund
									? "Sim, desfazer a devolução"
									: selfReported
										? "Sim, não recebi"
										: "Sim, desfazer"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Cancelar
				</Button>
			</div>
		</div>
	);
}

/** Título do sheet de confirmação. */
export function sharePaidTitle(
	mode: "paid" | "pending" | "refund",
	share: Pick<ExpenseShare, "name" | "amountCents" | "dueCents" | "refundCents"> & { method?: ExpenseShare["method"]; hasRefund?: boolean; /** Valor do último pagamento parcial, quando é ele que será desfeito. */ undoPartCents?: number; /** A própria pessoa desfazendo o seu aviso. */ own?: boolean; /** "Recebi só uma parte" aberto. */ partial?: boolean },
): string {
	if (mode === "paid" && share.partial) return `Quanto ${share.name} pagou?`;
	if (mode === "pending" && share.own) return "Desfazer seu último pagamento?";
	if (mode === "pending" && share.undoPartCents) return `Desfazer o último pagamento de ${share.name}?`;
	if (mode === "refund") return `Você devolveu ${formatBRL(share.refundCents)} para ${share.name}?`;
	if (mode === "pending" && share.hasRefund) return `Desfazer a devolução para ${share.name}?`;
	if (mode === "paid") return `${share.name} pagou ${formatBRL(share.dueCents > 0 ? share.dueCents : share.amountCents)}?`;
	if (share.method === "self") return `Você não recebeu de ${share.name}?`;
	return `Desfazer a marcação de ${share.name}?`;
}

type Blobs = Record<string, { url: string | null; state: "loading" | "ready" | "error" }>;

export function ExpenseDetail({ groupId, expenseId }: Readonly<{ groupId: string; expenseId: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [expense, setExpense] = useState<ExpenseDetailData | null>(null);
	const [error, setError] = useState<{ message: string; kind: "notMember" | "missing" | "other" } | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [qrOpen, setQrOpen] = useState<string | null>(null);
	const [codeFallback, setCodeFallback] = useState<string | null>(null);
	// Recém lançada: em vez do recadinho, abrimos o sheet "Avisar o grupo".
	const [paidNotice, setPaidNotice] = useState<{ amountCents: number; forName: string | null; hasReceipt: boolean; remainingCents?: number; afterParts?: boolean; /** Adiantamento de parcelas: o texto fala das parcelas abatidas. */ advance?: AdvanceDoneData } | null>(null);
	const [shareOpen, setShareOpen] = useState<"launched" | "manual" | "paid" | "summary" | "refund" | null>(() => (peekFlash() === LAUNCHED_FLASH ? "launched" : null));
	const [snack, setSnack] = useState<string | null>(() => {
		const f = peekFlash();
		return f === LAUNCHED_FLASH ? null : f;
	});
	const [refundNotice, setRefundNotice] = useState<{ amountCents: number; toName: string; hasReceipt: boolean } | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);
	const [copied, setCopied] = useState(false);
	const [resplitOpen, setResplitOpen] = useState(false);
	const [groupMembers, setGroupMembers] = useState<SplitMember[] | null>(null);
	const shareInvite = useShareInvite(groupId, shareOpen !== null && expenseShareCarriesInvite(shareOpen), groupMembers ? groupMembers.filter((m) => m.kind === "user").length <= 1 : undefined);
	const [resplitSelected, setResplitSelected] = useState<string[]>([]);
	const [resplitMode, setResplitMode] = useState<SplitMode>("all");
	const [resplitBusy, setResplitBusy] = useState(false);
	const [resplitError, setResplitError] = useState<string | null>(null);
	const [blobs, setBlobs] = useState<Blobs>({});
	const [viewing, setViewing] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	// Parcelas: antes de mudar a divisão ou apagar, pergunta quais parcelas (só esta ou esta e as próximas).
	const [scopeStep, setScopeStep] = useState<"resplit" | "delete" | null>(null);
	const [scope, setScope] = useState<InstallmentScope>("this");
	const [shareAction, setShareAction] = useState<{ uid: string; mode: "paid" | "pending" | "refund"; partial?: boolean } | null>(null);
	const [shareBusy, setShareBusy] = useState(false);
	const [shareError, setShareError] = useState<string | null>(null);
	// "Já paguei" / "Anexar comprovante" e o visualizador de comprovante (imagem).
	const [receiptSheet, setReceiptSheet] = useState<{ uid: string; mode: ReceiptMode; /** Pagamento parcial: quanto foi pago. */ amountCents?: number; /** Quanto a tela mostrava como já pago nesta parte (confere no servidor). */ expectedPaidCents?: number; /** Adiantamento de parcelas: o total que a tela mostrava faltando e quem recebe (confere no servidor). */ advance?: { dueCents: number; recipientId: string; recipientName: string } } | null>(null);
	// "Pagar outro valor": a parte (uid) e o valor digitado.
	const [otherAmount, setOtherAmount] = useState<{ uid: string; cents: number } | null>(null);
	// "Adiantar parcelas": a parte (uid), quem está agindo ("self" = paguei, "manual" = recebi), o valor e as parcelas em aberto (do servidor).
	const [advance, setAdvance] = useState<{ uid: string; mode: "self" | "manual"; cents: number; plan: AdvancePlanData | null; loadError: string | null; busy: boolean; error: string | null } | null>(null);
	const [receiptBusy, setReceiptBusy] = useState(false);
	const [receiptError, setReceiptError] = useState<string | null>(null);
	const [receiptFileError, setReceiptFileError] = useState<string | null>(null);
	const [receiptView, setReceiptView] = useState<{ name: string; url: string | null } | null>(null);
	const [helpOpen, setHelpOpen] = useState(false);
	const [helpWho, setHelpWho] = useState("");
	const [helpBusy, setHelpBusy] = useState(false);
	const [helpError, setHelpError] = useState<string | null>(null);
	const [names, setNames] = useState<Record<string, { name: string; picture: string | null }>>({});
	const urls = useRef<string[]>([]);

	useEffect(() => {
		clearFlash(); // o recado já foi lido ao criar o estado
	}, []);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<ExpenseDetailData>(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`)
			.then((d) => {
				if (!cancelled) setExpense(normalizeExpense(d));
			})
			.catch((e) => {
				if (cancelled) return;
				if (isNotMemberError(e)) setError({ message: "", kind: "notMember" });
				else if (isMissingExpenseError(e)) setError({ message: "", kind: "missing" });
				else setError({ message: e instanceof ApiError ? e.message : "Não foi possível carregar a despesa.", kind: "other" });
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId, expenseId, reloadKey]);

	// Nomes das pessoas que você cuida e poderiam ajudar (a API manda só os códigos).
	const needNames = !!expense && expense.helpAsUids.length > 0;
	useEffect(() => {
		if (!needNames) return;
		let cancelled = false;
		apiFetch<Group>(`/api/groups/${encodeURIComponent(groupId)}`)
			.then((g) => {
				if (!cancelled) setNames(Object.fromEntries(normalizeGroupDetail(g).members.map((m) => [m.uid, { name: m.name, picture: m.picture }])));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [needNames, groupId]);

	const attachmentUrl = useCallback(
		(aid: string) => `/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(aid)}`,
		[groupId, expenseId],
	);

	// Miniaturas: imagens são buscadas com o login e viram endereços locais (revogados ao sair da tela).
	useEffect(() => {
		if (!expense) return;
		let cancelled = false;
		for (const a of expense.attachments.filter((x) => isImageType(x.contentType))) {
			apiFetchBlob(attachmentUrl(a.id))
				.then((blob) => {
					const url = URL.createObjectURL(blob);
					if (cancelled) return URL.revokeObjectURL(url);
					urls.current.push(url);
					setBlobs((b) => ({ ...b, [a.id]: { url, state: "ready" } }));
				})
				.catch(() => {
					if (!cancelled) setBlobs((b) => ({ ...b, [a.id]: { url: null, state: "error" } }));
				});
		}
		return () => {
			cancelled = true;
		};
	}, [expense, attachmentUrl]);

	useEffect(() => {
		const list = urls.current;
		return () => {
			for (const u of list) URL.revokeObjectURL(u);
		};
	}, []);

	const attachments: AttachmentView[] = (expense?.attachments ?? []).map((a) => ({
		...a,
		url: blobs[a.id]?.url ?? null,
		state: isImageType(a.contentType) ? (blobs[a.id]?.state ?? "loading") : "ready",
	}));

	async function openPdf(aid: string) {
		try {
			await openBlobInNewTab(() => apiFetchBlob(attachmentUrl(aid)), expense?.attachments.find((x) => x.id === aid)?.name ?? "anexo.pdf", (u) => urls.current.push(u));
		} catch (e) {
			setSnack(e instanceof ApiError ? e.message : "Não foi possível abrir o PDF.");
		}
	}

	const receiptUrl = useCallback(
		(uid: string, kind: "payment" | "refund" = "payment", partId?: string) =>
			`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/shares/${encodeURIComponent(uid)}/${kind === "refund" ? "refund-receipt" : partId ? `part-receipt/${encodeURIComponent(partId)}` : "receipt"}`,
		[groupId, expenseId],
	);

	async function viewReceipt(uid: string, kind: "payment" | "refund" = "payment", partId?: string) {
		const found = expense?.shares.find((s) => s.uid === uid);
		const receipt = kind === "refund" ? found?.refund?.receipt : partId ? found?.parts.find((p) => p.id === partId)?.receipt : found?.receipt;
		if (!receipt) return;
		if (!isImageType(receipt.contentType)) {
			try {
				await openBlobInNewTab(() => apiFetchBlob(receiptUrl(uid, kind, partId)), receipt.name, (u) => urls.current.push(u));
			} catch (e) {
				setSnack(e instanceof ApiError ? e.message : "Não foi possível abrir o comprovante.");
			}
			return;
		}
		setReceiptView({ name: receipt.name, url: null });
		try {
			const url = URL.createObjectURL(await apiFetchBlob(receiptUrl(uid, kind, partId)));
			urls.current.push(url);
			setReceiptView({ name: receipt.name, url });
		} catch (e) {
			setReceiptView(null);
			setSnack(e instanceof ApiError ? e.message : "Não foi possível abrir o comprovante.");
		}
	}

	function openReceiptSheet(uid: string, mode: ReceiptMode, amountCents?: number, advance?: { dueCents: number; recipientId: string; recipientName: string }) {
		setReceiptError(null);
		setReceiptFileError(null);
		// `expectedPaidCents` sai do que a tela mostra agora; se a parte não está no estado local fica indefinido (e o envio não segue).
		setReceiptSheet({ uid, mode, amountCents, expectedPaidCents: amountCents !== undefined ? expense?.shares.find((s) => s.uid === uid)?.paidCents : undefined, advance });
	}

	/** Fecha a folha do comprovante. Se era de um adiantamento, volta para a folha de adiantar com o valor que a pessoa digitou. */
	function cancelReceipt() {
		const r = receiptSheet;
		setReceiptSheet(null);
		if (r?.advance && r.amountCents !== undefined) {
			setAdvance({ uid: r.uid, mode: "self", cents: r.amountCents, plan: null, loadError: null, busy: false, error: null });
			void loadAdvancePlan(r.uid, "self");
		}
	}

	const advanceUrl = `/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/advance`;

	/** Abre a folha de adiantar parcelas e busca no servidor as parcelas em aberto da pessoa na compra toda. */
	function openAdvance(uid: string, mode: "self" | "manual") {
		setAdvance({ uid, mode, cents: 0, plan: null, loadError: null, busy: false, error: null });
		void loadAdvancePlan(uid, mode);
	}

	// Respostas fora de ordem (fechar e reabrir, "Tentar de novo") não sobrescrevem o plano novo: só vale a ÚLTIMA busca pedida.
	const advanceReq = useRef(0);
	async function loadAdvancePlan(uid: string, mode: "self" | "manual") {
		const mine = ++advanceReq.current;
		try {
			const plan = await apiFetch<AdvancePlanData>(`${advanceUrl}?shareUid=${encodeURIComponent(uid)}&mode=${mode}`);
			if (mine !== advanceReq.current) return;
			setAdvance((a) => (a && a.uid === uid ? { ...a, plan, loadError: null } : a));
		} catch (e) {
			if (mine !== advanceReq.current) return;
			if (isNotMemberError(e) || isMissingExpenseError(e)) {
				setAdvance(null);
				setError({ message: "", kind: isNotMemberError(e) ? "notMember" : "missing" });
				return;
			}
			setAdvance((a) => (a && a.uid === uid ? { ...a, plan: null, loadError: e instanceof ApiError ? e.message : "Não foi possível carregar as parcelas." } : a));
		}
	}
	/** Fecha a folha e invalida qualquer busca em andamento. */
	function closeAdvance() {
		advanceReq.current++;
		setAdvance(null);
	}

	/**
	 * Erro ao registrar um adiantamento. Os valores mudaram (409): mostra a mensagem e atualiza a folha. Falha no meio (`advance_uncertain`,
	 * ou sem resposta da rede): parte do pagamento pode ter sido registrada, então recarrega a tela e pede para conferir antes de pagar de novo.
	 */
	async function handleAdvanceError(e: unknown, uid: string, mode: "self" | "manual", cents: number): Promise<"handled" | "other"> {
		if (isNotMemberError(e) || isMissingExpenseError(e)) {
			advanceReq.current++;
			setAdvance(null);
			setReceiptSheet(null);
			setError({ message: "", kind: isNotMemberError(e) ? "notMember" : "missing" });
			return "handled";
		}
		const uncertain = !(e instanceof ApiError) || e.status >= 500 || (e.status === 409 && e.code === "advance_uncertain");
		if (uncertain) {
			// Mostra a mensagem, recarrega os dados e mantém a folha com o valor digitado (a pessoa confere antes de pagar de novo).
			const message = e instanceof ApiError && e.status === 409 ? e.message : ADVANCE_UNCERTAIN;
			setReceiptSheet(null);
			setAdvance({ uid, mode, cents, plan: null, loadError: null, busy: false, error: message });
			setReloadKey((k) => k + 1);
			await loadAdvancePlan(uid, mode);
			return "handled";
		}
		if (e.status === 409) {
			setReceiptSheet(null);
			await refreshAfterAdvanceConflict(uid, e.message, mode);
			return "handled";
		}
		return "other";
	}

	/** O servidor diz que os valores mudaram: mostra a mensagem, recarrega a despesa e atualiza a folha com os valores novos. */
	async function refreshAfterAdvanceConflict(uid: string, message: string, mode: "self" | "manual") {
		setSnack(message);
		try {
			setExpense(normalizeExpense(await apiFetch<ExpenseDetailData>(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`)));
		} catch {
			setReloadKey((k) => k + 1);
		}
		setAdvance({ uid, mode, cents: 0, plan: null, loadError: null, busy: false, error: null });
		await loadAdvancePlan(uid, mode);
	}

	/** "Sim, recebi": quem pagou a despesa (ou o administrador) registra o valor, que o servidor reparte pelas parcelas. */
	async function confirmAdvanceReceived() {
		if (!advance?.plan || !expense) return;
		const { uid, cents, plan } = advance;
		const target = expense.shares.find((x) => x.uid === uid);
		setAdvance({ ...advance, busy: true, error: null });
		try {
			const res = await apiFetch<{ expense: ExpenseDetailData | null; advance: AdvanceDoneData }>(advanceUrl, {
				method: "POST",
				body: JSON.stringify({ shareUid: uid, mode: "manual", amountCents: cents, expectedDueCents: plan.totalDueCents, recipientId: plan.recipient?.id }),
			});
			if (res.expense) setExpense(normalizeExpense(res.expense));
			else setReloadKey((k) => k + 1);
			closeAdvance();
			setSnack(advanceDoneMessage(res.advance, { mode: "manual", name: target?.name ?? "a pessoa" }));
		} catch (e) {
			if ((await handleAdvanceError(e, uid, "manual", cents)) === "other") setAdvance((a) => (a ? { ...a, busy: false, error: e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo." } : a));
		}
	}

	async function submitReceipt(file: File | null) {
		if (!receiptSheet) return;
		const { uid, mode, amountCents, expectedPaidCents, advance: adv } = receiptSheet;
		if (adv && amountCents !== undefined) {
			await submitAdvanceReceipt(file, uid, amountCents, adv);
			return;
		}
		if (mode === "pay" && amountCents !== undefined && expectedPaidCents === undefined) {
			// A parte não está no que a tela tem: não adivinha "0 já pago". Recarrega e pede para tentar de novo.
			setReceiptSheet(null);
			setSnack("Esta conta mudou. Atualize e tente de novo.");
			setReloadKey((k) => k + 1);
			return;
		}
		setReceiptBusy(true);
		setReceiptError(null);
		setReceiptFileError(null);
		try {
			const body = new FormData();
			if (file) body.append("file", file);
			if (mode === "pay" && amountCents !== undefined) {
				body.append("amountCents", String(amountCents));
				body.append("expectedPaidCents", String(expectedPaidCents));
			}
			const updated = await apiFetch<ExpenseDetailData>(
			`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/shares/${encodeURIComponent(uid)}/${mode === "refund" ? "refund" : "payment"}`,
			{ method: "POST", body },
			);
			const next = normalizeExpense(updated);
			setExpense(next);
			setReceiptSheet(null);
			setSnack(receiptDoneMessage(mode));
			if (mode === "refund") {
			// Oferece avisar quem recebeu de volta, com o link da despesa (onde está a devolução e o comprovante).
			const back = next.shares.find((x) => x.uid === uid);
			if (back?.refund) {
				setRefundNotice({ amountCents: back.refund.cents, toName: back.name, hasReceipt: !!back.refund.receipt });
				setShareOpen("refund");
			}
			return;
			}
			// Oferece avisar no WhatsApp, com o link da despesa (onde quem recebe vê o pagamento e o comprovante).
			const mine = next?.shares.find((x) => x.uid === uid);
			if (mine) {
				// Pagamento parcial: o texto fala do valor pago agora e do que ainda falta.
				setPaidNotice(
					amountCents !== undefined && mine.dueCents > 0
						? { amountCents, forName: mine.isYou ? null : mine.name, hasReceipt: !!mine.parts.at(-1)?.receipt, remainingCents: mine.dueCents }
						: { ...paidNoticeAmount(mine), forName: mine.isYou ? null : mine.name, hasReceipt: !!(mine.receipt ?? mine.parts.at(-1)?.receipt) },
				);
				setShareOpen("paid");
			}
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				// A despesa mudou enquanto isso (valor maior que o que falta, ou conta mudou): recarrega, mostra a mensagem e atualiza
				// a folha com o que falta agora (ou fecha, se não falta nada).
				setReceiptSheet(null);
				setSnack(e.message);
				try {
					const fresh = normalizeExpense(await apiFetch<ExpenseDetailData>(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`));
					setExpense(fresh);
					const t = fresh.shares.find((x) => x.uid === uid);
					if (mode === "pay" && amountCents !== undefined && t && t.status === "pending" && t.dueCents > 0) setOtherAmount({ uid, cents: 0 });
				} catch {
					setReloadKey((k) => k + 1);
				}
			} else if (e instanceof ApiError && e.status === 422 && e.field === "file") {
				setReceiptFileError(e.message);
			} else {
				setReceiptError(e instanceof ApiError ? e.message : "Não foi possível enviar. Tente de novo.");
			}
		} finally {
			setReceiptBusy(false);
		}
	}

	/** "Já paguei" de um adiantamento: um valor, um comprovante opcional; o servidor reparte pelas parcelas (tudo ou nada). */
	async function submitAdvanceReceipt(file: File | null, uid: string, amountCents: number, adv: { dueCents: number; recipientId: string; recipientName: string }) {
		setReceiptBusy(true);
		setReceiptError(null);
		setReceiptFileError(null);
		try {
			const body = new FormData();
			if (file) body.append("file", file);
			body.append("shareUid", uid);
			body.append("mode", "self");
			body.append("amountCents", String(amountCents));
			body.append("expectedDueCents", String(adv.dueCents));
			body.append("recipientId", adv.recipientId);
			const res = await apiFetch<{ expense: ExpenseDetailData | null; advance: AdvanceDoneData }>(advanceUrl, { method: "POST", body });
			const next = res.expense ? normalizeExpense(res.expense) : null;
			if (next) setExpense(next);
			else setReloadKey((k) => k + 1);
			setReceiptSheet(null);
			const mine = (next ?? expense)?.shares.find((x) => x.uid === uid);
			setSnack(advanceDoneMessage(res.advance, { mode: "self", name: mine?.name ?? "" }));
			// Oferece avisar no WhatsApp: o texto fala das parcelas abatidas, sem chave Pix.
			setPaidNotice({ amountCents: res.advance.totalCents, forName: mine && !mine.isYou ? mine.name : null, hasReceipt: res.advance.hasReceipt, advance: res.advance });
			setShareOpen("paid");
		} catch (e) {
			if ((await handleAdvanceError(e, uid, "self", amountCents)) === "handled") {
				/* tratado */
			} else if (e instanceof ApiError && e.status === 422 && e.field === "file") {
				setReceiptFileError(e.message);
			} else {
				setReceiptError(e instanceof ApiError ? e.message : "Não foi possível enviar. Tente de novo.");
			}
		} finally {
			setReceiptBusy(false);
		}
	}

	async function remove() {
		setDeleting(true);
		setDeleteError(null);
		try {
			const query = expense?.installment ? `?scope=${scope}` : "";
			const res = await apiFetch<{ deleted?: number; kept?: number } | null>(
				`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}${query}`,
				{ method: "DELETE" },
			);
			setFlash(deleteFlashMessage({ scope: expense?.installment ? scope : "this", installment: !!expense?.installment, deleted: res?.deleted, kept: res?.kept }));
			router.replace(`/app/grupos/${encodeURIComponent(groupId)}`);
		} catch (e) {
			setDeleteError(e instanceof ApiError ? e.message : "Não foi possível apagar. Tente de novo.");
			setDeleting(false);
		}
	}

	async function confirmShare(amountCents?: number) {
		if (!shareAction || !expense) return;
		const target = expense.shares.find((s) => s.uid === shareAction.uid);
		if (!target) return;
		setShareBusy(true);
		setShareError(null);
		try {
			const updated = await apiFetch<ExpenseDetailData>(
				`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/shares/${encodeURIComponent(target.uid)}`,
				{
					method: "PATCH",
					// Desfazer SEMPRE manda quanto a tela mostrava como já pago (o servidor recusa se mudou); "Recebi só uma parte" também.
					body: JSON.stringify({
						status: shareAction.mode === "pending" ? "pending" : "paid",
						...(shareAction.mode === "pending" ? { expectedPaidCents: target.paidCents } : shareAction.mode === "paid" && amountCents !== undefined ? { amountCents, expectedPaidCents: target.paidCents } : {}),
					}),
				},
			);
			setExpense(normalizeExpense(updated));
			setShareAction(null);
			setSnack(
				shareAction.mode === "refund"
					? `Devolução para ${target.name} registrada.`
					: shareAction.mode === "paid"
						? amountCents !== undefined && amountCents < target.dueCents
							? `Recebido ${formatBRL(amountCents)} de ${target.name}. Faltam ${formatBRL(target.dueCents - amountCents)}.`
							: `Parte de ${target.name} marcada como paga.`
						: target.refund
							? `Devolução para ${target.name} desfeita.`
							: `Marcação de ${target.name} desfeita.`,
			);
		} catch (e) {
			if (e instanceof ApiError && e.status === 409 && (e.field === "amountCents" || shareAction.mode === "pending")) {
				// A parte mudou enquanto isso (valor, ou o que o desfazer anunciava): mostra como está agora e não desfaz.
				setShareAction(null);
				setSnack(e.message);
				setReloadKey((k) => k + 1);
			} else setShareError(e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo.");
		} finally {
			setShareBusy(false);
		}
	}

	function openHelp() {
		if (!expense) return;
		setHelpError(null);
		setHelpWho(helperOptions(expense, names)[0]?.uid ?? "");
		setHelpOpen(true);
	}

	async function confirmHelp() {
		if (!expense) return;
		const options = helperOptions(expense, names);
		const chosen = options.find((o) => o.uid === helpWho) ?? options[0];
		if (!chosen) return;
		setHelpBusy(true);
		setHelpError(null);
		try {
			const updated = await apiFetch<ExpenseDetailData>(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/help`, {
				method: "POST",
				body: JSON.stringify(chosen.isYou ? {} : { forUid: chosen.uid }),
			});
			setExpense(normalizeExpense(updated));
			setHelpOpen(false);
			setSnack(chosen.isYou ? "Obrigado! Você entrou na divisão." : `Obrigado! ${chosen.name} entrou na divisão.`);
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				// Já está na divisão: fecha e mostra a despesa como está agora.
				setHelpOpen(false);
				setSnack(e.message);
				setReloadKey((k) => k + 1);
			} else {
				setHelpError(e instanceof ApiError ? e.message : "Não foi possível entrar na divisão. Tente de novo.");
			}
		} finally {
			setHelpBusy(false);
		}
	}

	function openResplit() {
		if (!expense) return;
		setResplitError(null);
		setResplitSelected(expense.participantUids);
		setResplitMode("choose");
		setResplitOpen(true);
		if (!groupMembers) {
			apiFetch<Group>(`/api/groups/${encodeURIComponent(groupId)}`)
				.then((g) => {
					const list = normalizeGroupDetail(g).members.map((m) => ({ uid: m.uid, name: m.name, picture: m.picture, isYou: m.isYou, kind: m.kind }));
					setGroupMembers(list);
					setResplitMode(modeFor(expense.participantUids, list.map((m) => m.uid)));
				})
				.catch((e) => setResplitError(e instanceof ApiError ? e.message : "Não foi possível carregar as pessoas do grupo."));
		} else {
			setResplitMode(modeFor(expense.participantUids, groupMembers.map((m) => m.uid)));
		}
	}

	async function confirmResplit() {
		if (!expense) return;
		setResplitBusy(true);
		setResplitError(null);
		try {
			const updated = await apiFetch<ExpenseDetailData>(
				`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/participants`,
				{ method: "PUT", body: JSON.stringify({ participantUids: resplitSelected, ...(expense.installment ? { scope } : {}) }) },
			);
			setExpense(normalizeExpense(updated));
			setResplitOpen(false);
			setSnack(expense.installment && scope === "following" ? "Divisão atualizada nas parcelas." : "Divisão atualizada.");
		} catch (e) {
			setResplitError(e instanceof ApiError ? e.message : "Não foi possível recalcular. Tente de novo.");
		} finally {
			setResplitBusy(false);
		}
	}

	if (error?.kind === "notMember") return <NotMemberState />;
	if (error) {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title={error.kind === "missing" ? "Despesa não encontrada" : "Ops!"}
				action={
					<>
						{error.kind !== "missing" && (
							<Button
								icon="refresh"
								onClick={() => {
									setError(null);
									setReloadKey((k) => k + 1);
								}}
							>
								Tentar de novo
							</Button>
						)}
						<Button href={`/app/grupos/${encodeURIComponent(groupId)}`} variant={error.kind === "missing" ? "filled" : "outlined"}>
							Voltar para o grupo
						</Button>
					</>
				}
			>
				{error.kind === "missing" ? "Essa despesa não existe mais." : error.message}
			</EmptyState>
		);
	}
	if (!expense) return <ExpenseDetailSkeleton />;

	const viewed = attachments.find((a) => a.id === viewing);
	const shareTarget = shareAction ? expense.shares.find((s) => s.uid === shareAction.uid) : undefined;
	const otherTarget = otherAmount ? expense.shares.find((s) => s.uid === otherAmount.uid) : undefined;
	// Código Pix do valor digitado em "Pagar outro valor" (só quando é um valor possível).
	const otherCheck = otherAmount && otherTarget ? checkAmount(otherAmount.cents, otherTarget.dueCents) : null;
	const otherPayload = otherAmount && (otherCheck?.kind === "part" || otherCheck?.kind === "full") ? payloadFor(expense, otherAmount.cents) : null;
	// Lançada, cobrança e resumo levam o convite do grupo (destino na despesa); "paguei" e "devolvi" levam o link simples.
	// Texto de "lançada" e introdução da folha: a contagem real de parcelas e se os valores são iguais.
	// O resumo usa `expense`: ele diz "parcela N de M" e apagar uma parcela não renumera as outras.
	const shareable = shareableExpense(expense);
	const shareLink = expenseShareLink(shareOpen ?? "launched", window.location.origin, shareInvite.token, groupId, expenseId);
	const shareText =
		shareOpen === "paid" && paidNotice
			? paidNotice.advance
				? buildAdvanceShareText({ totalCents: paidNotice.advance.totalCents, description: expense.description, forName: paidNotice.forName, items: paidNotice.advance.items, hasReceipt: paidNotice.hasReceipt }, shareLink)
				: buildPaidShareText({ ...paidNotice, description: expense.description }, shareLink)
			: shareOpen === "refund" && refundNotice
				? buildRefundShareText({ ...refundNotice, description: expense.description }, shareLink)
				: shareOpen === "summary"
					? buildExpenseStatusText(expense, shareLink)
					: buildExpenseShareText(shareable, shareLink);
	const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
	const hasNext = !!expense.installment && expense.installment.number < expense.installment.count;
	const closeShare = () => {
		setShareOpen(null);
		setCopyFailed(false);
		setCopied(false);
	};
	const openShare = (uid: string, mode: "paid" | "pending" | "refund") => {
		setShareError(null);
		setShareAction({ uid, mode });
	};

	return (
		<>
			<ExpenseDetailView
				expense={expense}
				attachments={attachments}
				qrOpen={qrOpen}
				codeFallback={codeFallback}
				onToggleQr={(uid) => setQrOpen((o) => (o === uid ? null : uid))}
				onCopyCode={(key) => {
					// "r:<uid>" = devolução (Pix de quem recebe de volta); sem prefixo = parte de quem deve.
					const isRefund = key.startsWith("r:");
					const uid = isRefund ? key.slice(2) : key;
					const target = expense.shares.find((s) => s.uid === uid);
					const code = target ? (isRefund ? refundPayload(expense, target) : payloadFor(expense, target.dueCents)) : null;
					if (!code || !target) return;
					void copyText(code).then((ok) => {
						setCodeFallback(ok ? null : key);
						if (ok) setSnack(isRefund ? `Código Pix da devolução para ${target.name} copiado! Agora cole no app do banco.` : target.youManage ? `Código Pix da parte de ${target.name} copiado! Agora cole no app do banco.` : "Código Pix copiado! Agora cole no app do seu banco.");
					});
				}}
				onCopyKey={(refundKey) => {
					const key = keyToCopy(expense, refundKey);
					if (!key) return;
					void copyText(key).then((ok) => setSnack(ok ? "Chave Pix copiada!" : "Não deu para copiar. Selecione a chave e copie."));
				}}
				onEdit={() => router.push(`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(expenseId)}/editar`)}
				onShareSummary={() => setShareOpen("summary")}
				onViewRefundReceipt={(uid) => void viewReceipt(uid, "refund")}
				onViewPartReceipt={(uid, partId) => void viewReceipt(uid, "payment", partId)}
				onOtherAmount={(uid) => (expense.installment ? openAdvance(uid, "self") : setOtherAmount({ uid, cents: 0 }))}
				onOpenImage={(id) => setViewing(id)}
				onOpenPdf={(id) => void openPdf(id)}
				onAskDelete={() => {
					setDeleteError(null);
					setScope("this");
					if (hasNext) setScopeStep("delete");
					else setConfirmingDelete(true);
				}}
				onMarkPaid={(uid) => openShare(uid, "paid")}
				onUndoPaid={(uid) => openShare(uid, "pending")}
				onGiveBack={(uid) => openReceiptSheet(uid, "refund")}
				onEditParticipants={() => {
					setScope("this");
					if (hasNext) setScopeStep("resplit");
					else openResplit();
				}}
				onShare={() => setShareOpen("manual")}
				onHelp={openHelp}
				onPaid={(uid) => openReceiptSheet(uid, "pay")}
				onViewReceipt={(uid) => void viewReceipt(uid)}
				onAttachReceipt={(uid) => openReceiptSheet(uid, "attach")}
				onTellPaid={(uid) => {
					const mine = expense.shares.find((x) => x.uid === uid);
					if (!mine) return;
					setPaidNotice({ ...paidNoticeAmount(mine), forName: mine.isYou ? null : mine.name, hasReceipt: !!mine.receipt });
					setShareOpen("paid");
				}}
			/>

			<Sheet
				open={!!advance}
				onClose={() => {
					if (!advance?.busy) closeAdvance();
				}}
				title={advance?.mode === "manual" ? "Recebi um valor" : "Adiantar parcelas"}
			>
				{advance && (
					<AdvanceContent
						mode={advance.mode}
						plan={advance.plan}
						loadError={advance.loadError}
						personName={expense.shares.find((x) => x.uid === advance.uid)?.name ?? ""}
						payeeName={advance.plan?.recipient?.name ?? expense.paidBy.name}
						cents={advance.cents}
						hasPix={!!advance.plan?.recipient?.pix}
						canCopy={advance.mode === "self" && !!advance.plan && advancePayload(advance.plan, expense.description, advance.cents) !== null}
						busy={advance.busy}
						error={advance.error}
						onCents={(cents) => setAdvance((a) => (a ? { ...a, cents, error: null } : a))}
						onCopy={() => {
							const code = advance.plan ? advancePayload(advance.plan, expense.description, advance.cents) : null;
							if (code) void copyText(code).then((ok) => setSnack(ok ? "Código Pix copiado! Agora cole no app do seu banco." : "Não deu para copiar sozinho. Use a chave Pix da tela."));
						}}
						onCopyKey={() => {
							const key = advance.plan?.recipient?.pix?.key;
							if (key) void copyText(key).then((ok) => setSnack(ok ? "Chave Pix copiada!" : "Não deu para copiar. Selecione a chave e copie."));
						}}
						onRetry={() => {
							setAdvance({ ...advance, loadError: null });
							void loadAdvancePlan(advance.uid, advance.mode);
						}}
						onConfirm={() => {
							if (!advance.plan?.recipient) return;
							if (advance.mode === "manual") void confirmAdvanceReceived();
							else {
								const { uid, cents, plan } = advance;
								closeAdvance();
								openReceiptSheet(uid, "pay", cents, { dueCents: plan.totalDueCents, recipientId: plan.recipient!.id, recipientName: plan.recipient!.name });
							}
						}}
						onCancel={closeAdvance}
					/>
				)}
			</Sheet>

			<Sheet open={!!otherAmount} onClose={() => setOtherAmount(null)} title="Pagar outro valor">
				{otherAmount && otherTarget && (
					<OtherAmountContent
						dueCents={otherTarget.dueCents}
						payeeName={expense.pix?.payeeName ?? expense.paidBy.name}
						cents={otherAmount.cents}
						hasPix={!!expense.pix}
						canCopy={otherPayload !== null}
						onCopyKey={() => {
							const key = keyToCopy(expense);
							if (key) void copyText(key).then((ok) => setSnack(ok ? "Chave Pix copiada!" : "Não deu para copiar. Selecione a chave e copie."));
						}}
						onCents={(cents) => setOtherAmount({ ...otherAmount, cents })}
						onCopy={() => {
							if (!otherPayload) return;
							void copyText(otherPayload).then((ok) =>
								setSnack(ok ? "Código Pix copiado! Agora cole no app do seu banco." : "Não deu para copiar sozinho. Use a chave Pix da tela."),
							);
						}}
						onPaid={() => {
							const { uid, cents } = otherAmount;
							setOtherAmount(null);
							openReceiptSheet(uid, "pay", cents);
						}}
						onCancel={() => setOtherAmount(null)}
					/>
				)}
			</Sheet>

			<Sheet
				open={!!receiptSheet}
				onClose={() => {
					if (!receiptBusy) cancelReceipt();
				}}
				title={receiptSheet ? receiptSheetCopy(receiptSheet.mode, receiptSheet.mode === "refund" ? (expense.shares.find((s) => s.uid === receiptSheet.uid)?.name ?? "") : (receiptSheet.advance?.recipientName ?? expense.pix?.payeeName ?? expense.paidBy.name), 0, receiptSheet.amountCents).title : ""}
			>
				{receiptSheet && (
					<ReceiptSheetBody
						key={`${receiptSheet.uid}-${receiptSheet.mode}`}
						mode={receiptSheet.mode}
						partialCents={receiptSheet.amountCents}
						payeeName={receiptSheet.mode === "refund" ? (expense.shares.find((s) => s.uid === receiptSheet.uid)?.name ?? "") : (receiptSheet.advance?.recipientName ?? expense.pix?.payeeName ?? expense.paidBy.name)}
						busy={receiptBusy}
						error={receiptError}
						fileError={receiptFileError}
						onSubmit={(f) => void submitReceipt(f)}
						onCancel={cancelReceipt}
					/>
				)}
			</Sheet>

			<Sheet open={!!receiptView} onClose={() => setReceiptView(null)} title="Comprovante">
				{receiptView?.url ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={receiptView.url} alt={receiptView.name} className="max-h-[65dvh] w-full rounded-shape-md bg-surface-container-high object-contain" />
				) : (
					<p role="status" className="py-8 text-center text-body-large text-on-surface-variant">
						Abrindo...
					</p>
				)}
				<Button variant="tonal" fullWidth onClick={() => setReceiptView(null)} className="mt-4">
					Fechar
				</Button>
			</Sheet>

			<Sheet
				open={helpOpen}
				onClose={() => {
					if (!helpBusy) setHelpOpen(false);
				}}
				title="Quero ajudar"
			>
				<HelpContent
					expense={expense}
					options={helperOptions(expense, names)}
					who={helpWho}
					busy={helpBusy}
					error={helpError}
					onWho={setHelpWho}
					onConfirm={() => void confirmHelp()}
					onCancel={() => setHelpOpen(false)}
				/>
			</Sheet>

			<Sheet
				open={shareOpen !== null}
				onClose={closeShare}
				title={shareOpen === "paid" || shareOpen === "refund" ? "Avisar no WhatsApp" : shareOpen === "manual" ? "Cobrar no WhatsApp" : shareOpen === "summary" ? "Compartilhar resumo" : LAUNCHED_FLASH}
			>
				<ShareExpenseContent
					text={shareText}
					intro={
						shareOpen === "paid"
							? `Mande para ${expense.paidBy.name} saber que você pagou. O link abre a despesa${paidNotice?.hasReceipt ? " com o seu comprovante" : ""}.`
							: shareOpen === "refund"
								? `Avise ${refundNotice?.toName ?? "a pessoa"} que o dinheiro foi devolvido. O link abre a despesa${refundNotice?.hasReceipt ? " com o comprovante da devolução" : ""}.`
								: shareOpen === "summary"
									? expenseSummaryIntro()
									: shareIntro(shareOpen === "manual" ? "manual" : "launched", shareable.installment?.count)
					}
					notice={
						shareInvite.token && shareInvite.solo ? `${SOLO_SHARE_NOTICE} ${SOLO_SHARE_EXPENSE_HINT}` : undefined
					}
					loading={shareInvite.status === "loading"}
					whatsappLabel={shareOpen === "summary" ? "Compartilhar no WhatsApp" : undefined}
					preview={shareOpen === "summary"}
					canShare={canNativeShare}
					copyFailed={copyFailed}
					dismissLabel={shareOpen === "manual" || shareOpen === "summary" ? "Fechar" : "Agora não"}
					onCopy={() =>
						void copyText(shareText).then((ok) => {
							setCopyFailed(!ok);
							setCopied(ok);
						})
					}
					onShare={() => {
						void navigator.share({ text: shareText }).catch(() => {});
					}}
					onClose={closeShare}
				/>
				<Snackbar open={copied} message="Mensagem copiada!" onClose={() => setCopied(false)} />
			</Sheet>

			<Sheet
				tall
				open={resplitOpen}
				onClose={() => {
					if (!resplitBusy) setResplitOpen(false);
				}}
				title="Mudar quem divide"
			>
				<ResplitContent
					expense={expense}
					members={groupMembers}
					selected={resplitSelected}
					mode={resplitMode}
					busy={resplitBusy}
					error={resplitError}
					onMode={(m) => {
						setResplitMode(m);
						if (m === "all" && groupMembers) setResplitSelected(groupMembers.map((x) => x.uid));
					}}
					onToggle={(uid) => setResplitSelected((cur) => (cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid]))}
					onConfirm={() => void confirmResplit()}
					onCancel={() => setResplitOpen(false)}
				/>
			</Sheet>

			<Sheet
				open={!!shareAction}
				onClose={() => {
					if (!shareBusy) setShareAction(null);
				}}
				title={shareAction && shareTarget ? sharePaidTitle(shareAction.mode, { ...shareTarget, hasRefund: !!shareTarget.refund, undoPartCents: undoPartCentsOf(shareTarget), own: !expense.canMarkPaid && shareTarget.canUndoOwnPart, partial: shareAction.partial }) : ""}
			>
				{shareAction && shareTarget && (
					<SharePaidContent
						mode={shareAction.mode}
						selfReported={shareTarget.method === "self" && !shareTarget.refund}
						undoRefund={!!shareTarget.refund}
						undoPartCents={shareAction.mode === "pending" ? undoPartCentsOf(shareTarget) : undefined}
						dueCents={shareTarget.dueCents}
						onPartialChange={(partial) => setShareAction((a) => (a ? { ...a, partial } : a))}
						onAdvance={
							expense.installment && shareAction.mode === "paid" && (expense.series?.items ?? []).some((i) => i.id !== expense.id && i.openUids?.includes(shareAction.uid))
								? () => {
										const uid = shareAction.uid;
										setShareAction(null);
										openAdvance(uid, "manual");
									}
								: undefined
						}
						busy={shareBusy}
						error={shareError}
						onConfirm={(amountCents) => void confirmShare(amountCents)}
						onCancel={() => setShareAction(null)}
					/>
				)}
			</Sheet>

			<Sheet open={!!viewed} onClose={() => setViewing(null)} title={viewed?.name ?? ""}>
				{viewed?.url && (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={viewed.url} alt={viewed.name} className="max-h-[65dvh] w-full rounded-shape-md bg-surface-container-high object-contain" />
				)}
				<Button variant="tonal" fullWidth onClick={() => setViewing(null)} className="mt-4">
					Fechar
				</Button>
			</Sheet>

			<Sheet open={scopeStep === "resplit"} onClose={() => setScopeStep(null)} title="Mudar quem divide">
				{expense.installment && (
					<ResplitScopeContent
						scope={scope}
						number={expense.installment.number}
						count={expense.installment.count}
						onScope={setScope}
						onContinue={() => {
							setScopeStep(null);
							openResplit();
						}}
						onCancel={() => setScopeStep(null)}
					/>
				)}
			</Sheet>

			<Sheet
				open={scopeStep === "delete"}
				onClose={() => {
					if (!deleting) setScopeStep(null);
				}}
				title="Apagar qual parcela?"
			>
				{expense.installment && (
					<DeleteInstallmentContent
						scope={scope}
						number={expense.installment.number}
						count={expense.installment.count}
						busy={deleting}
						error={deleteError}
						onScope={setScope}
						onConfirm={() => void remove()}
						onCancel={() => setScopeStep(null)}
					/>
				)}
			</Sheet>

			<Sheet
				open={confirmingDelete}
				onClose={() => {
					if (!deleting) setConfirmingDelete(false);
				}}
				title={expense.installment ? "Apagar esta parcela?" : "Apagar esta despesa?"}
			>
				<DeleteExpenseContent busy={deleting} error={deleteError} onConfirm={() => void remove()} onCancel={() => setConfirmingDelete(false)} />
			</Sheet>

			<Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} aboveNav />
		</>
	);
}

/** A despesa como o texto de "avisar o grupo" pode descrevê-la: parcelas que existem e valor igual só quando é verdade. */
function shareableExpense(e: ExpenseDetailData) {
	if (!e.installment) return e;
	const info = installmentShareInfo(e.installment, e.series);
	return { ...e, installment: { ...e.installment, count: info.count }, installmentsDiffer: !info.sameValue };
}
