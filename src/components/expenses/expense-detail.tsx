"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ActionChip, Avatar, Banner, Button, Card, EmptyState, Icon, List, Sheet, Skeleton, Snackbar, StatusChip } from "@/components/ui";
import type { Group } from "@/components/groups/group-detail";
import { normalizeGroupDetail } from "@/components/groups/types";
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { buildPixPayload } from "@/lib/pix/brcode";
import { copyText } from "@/lib/ui/clipboard";
import { formatDateLong, formatDateShort, todayISO } from "@/lib/ui/dates";
import { deleteFlashMessage, dueLong, installmentLabel } from "@/lib/ui/due-dates";
import { isImageType } from "@/lib/ui/attachments";
import { buildExpenseLink, buildExpenseShareText, buildPaidShareText, shareIntro } from "@/lib/ui/expense-share";
import { paidByLabel, shareStatusChip } from "@/lib/ui/expense-status";
import { paidCaption, receiptActions, receiptDoneMessage, receiptSheetCopy, undoLabel, type ReceiptMode } from "@/lib/ui/receipts";
import { managedCaption } from "@/lib/ui/managed";
import { HelpCard, HelpContent, canHelpOn, helperOptions } from "./help";
import { ExpenseAttachments, type AttachmentView } from "./expense-attachments";
import { DeleteInstallmentContent, ResplitScopeContent, type InstallmentScope } from "./installment-scope";
import { InstallmentsSection } from "./installments-section";
import { ShareExpenseContent } from "./expense-share";
import { openBlobInNewTab } from "./open-blob";
import { ReceiptSheetBody } from "./receipt-sheet";
import { AccountHeader, PixPayCard } from "./pix-pay-card";
import { ResplitContent } from "./resplit-sheet";
import { clearFlash, normalizeExpense, peekFlash, setFlash, type ExpenseDetailData, type ExpenseShare } from "./types";
import { modeFor, type SplitMember, type SplitMode } from "./who-splits";

export const LAUNCHED_FLASH = "Despesa lançada!";

/** Código "Copia e Cola" da parte de quem deve, ou null se os dados não permitem gerar. */
export function payloadFor(expense: ExpenseDetailData, shareCents: number): string | null {
	try {
		return buildPixPayload({ key: expense.pix.key, payeeName: expense.pix.payeeName, amountCents: shareCents, txid: `R${expense.id}` });
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
}: Readonly<{
	share: ExpenseShare;
	canMarkPaid: boolean;
	onMarkPaid: (uid: string) => void;
	onUndoPaid: (uid: string) => void;
	onGiveBack: (uid: string) => void;
	onViewReceipt: (uid: string) => void;
	onAttachReceipt: (uid: string) => void;
}>) {
	const chip = shareStatusChip(s.status, s);
	const canAct = canMarkPaid && s.status !== "payer";
	const when = paidDateLabel(s.paidAt);
	const caption = managedCaption(s);
	const receiptAct = receiptActions(s);
	const paidNote = paidCaption(s, when);
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
						{canAct && s.status === "refund" && (
							<ActionChip icon="check" onClick={() => onGiveBack(s.uid)}>
								Devolvi
							</ActionChip>
						)}
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
						{canAct && s.status === "paid" && <ActionChip onClick={() => onUndoPaid(s.uid)}>{undoLabel(s)}</ActionChip>}
					</span>
				</div>
			</div>
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
}: Readonly<{ share: ExpenseShare; ownerName: string; labeled: boolean; headingId: string }>) {
	const refund = share.status === "refund";
	const managed = share.youManage;
	const who = managed ? share.name : "Você";
	const told = share.method === "self";
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
				</div>
			</div>
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
}: Readonly<{
	expense: ExpenseDetailData;
	attachments: AttachmentView[];
	/** Parte (uid) cujo QR Code está aberto. */
	qrOpen: string | null;
	/** Parte (uid) cujo código não pôde ser copiado sozinho. */
	codeFallback: string | null;
	onToggleQr: (uid: string) => void;
	onCopyCode: (uid: string) => void;
	onCopyKey: () => void;
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
}>) {
	// Contas que a pessoa controla nesta despesa: a dela e as das pessoas sem celular que ela cuida (a dela primeiro).
	const accounts = expense.shares
		.filter((s) => (s.isYou || s.youManage) && s.status !== "payer")
		.sort((a, b) => Number(b.isYou) - Number(a.isYou));
	const today = todayISO();
	const due = dueLong(expense.dueDate, expense.overdue, today);
	const labeled = expense.shares.some((s) => s.youManage) || expense.paidBy.youManage;
	const youPaid = expense.paidBy.isYou || expense.paidBy.youManage;
	const payerManaged = expense.paidBy.youManage;
	const payerName = expense.paidBy.name;
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
		/>
	);

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<header className="space-y-1">
				{expense.installment && (
					<p className="pb-1">
						<StatusChip tone="neutral">{installmentLabel(expense.installment)}</StatusChip>
					</p>
				)}
				<h1 className="break-words text-headline-medium md:text-headline-large">{expense.description}</h1>
				<p className="money text-display-small font-bold">{formatBRL(expense.amountCents)}</p>
				<p className="text-body-large text-on-surface-variant">
					{paidByLabel(expense.paidBy)} · {formatDateLong(expense.date)}
				</p>
				{due && (
					<p className={`flex items-center gap-2 text-title-medium ${due.overdue ? "text-error" : "text-on-surface"}`}>
						<Icon name={due.overdue ? "warning" : "calendar_today"} size={22} />
						{due.text}
					</p>
				)}
				<Button variant="text" size="md" icon="share" onClick={onShare} className="-ml-4">
					Avisar no WhatsApp
				</Button>
			</header>

			{canHelpOn(expense) && <HelpCard expense={expense} onHelp={onHelp} />}

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
							payeeName={expense.pix.payeeName}
							pix={expense.pix}
							payload={payloadFor(expense, s.dueCents)}
							qrOpen={qrOpen === s.uid}
							codeFallback={codeFallback === s.uid}
							onToggleQr={() => onToggleQr(s.uid)}
							onCopyCode={() => onCopyCode(s.uid)}
							onCopyKey={onCopyKey}
							canPay={s.canPay}
							onPaid={() => onPaid(s.uid)}
						/>
					);
				}
				if (s.status === "refund" || (s.status === "paid" && s.participates)) {
					return <PartStatusCard key={s.uid} share={s} ownerName={payerName} labeled={labeled} headingId={headingId} />;
				}
				return null;
			})}

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
	busy,
	error,
	onConfirm,
	onCancel,
}: Readonly<{
	mode: "paid" | "pending" | "refund";
	/** A pessoa avisou que pagou: desfazer vira "Não recebi". */
	selfReported?: boolean;
	busy: boolean;
	error: string | null;
	onConfirm: () => void;
	onCancel: () => void;
}>) {
	const marking = mode === "paid";
	const giving = mode === "refund";
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">
				{giving
					? "Use quando você já devolveu o dinheiro, por Pix ou em dinheiro."
					: marking
						? "Use quando a pessoa pagou em dinheiro ou combinou de outra forma."
						: selfReported
							? "O aviso e o comprovante somem e a parte volta a ficar em aberto."
							: "A marcação some e a parte volta a ficar em aberto."}
			</p>
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button onClick={onConfirm} loading={busy} disabled={busy} fullWidth>
					{giving
						? busy
							? "Salvando..."
							: "Sim, devolvi"
						: marking
							? busy
								? "Marcando..."
								: "Sim, marcar como pago"
							: busy
								? "Desfazendo..."
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
	share: Pick<ExpenseShare, "name" | "amountCents" | "dueCents" | "refundCents"> & { method?: ExpenseShare["method"] },
): string {
	if (mode === "refund") return `Você devolveu ${formatBRL(share.refundCents)} para ${share.name}?`;
	if (mode === "paid") return `${share.name} pagou ${formatBRL(share.dueCents > 0 ? share.dueCents : share.amountCents)}?`;
	if (share.method === "self") return `Você não recebeu de ${share.name}?`;
	return `Desfazer a marcação de ${share.name}?`;
}

type Blobs = Record<string, { url: string | null; state: "loading" | "ready" | "error" }>;

export function ExpenseDetail({ groupId, expenseId }: Readonly<{ groupId: string; expenseId: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [expense, setExpense] = useState<ExpenseDetailData | null>(null);
	const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [qrOpen, setQrOpen] = useState<string | null>(null);
	const [codeFallback, setCodeFallback] = useState<string | null>(null);
	// Recém lançada: em vez do recadinho, abrimos o sheet "Avisar o grupo".
	const [paidNotice, setPaidNotice] = useState<{ amountCents: number; forName: string | null; hasReceipt: boolean } | null>(null);
	const [shareOpen, setShareOpen] = useState<"launched" | "manual" | "paid" | null>(() => (peekFlash() === LAUNCHED_FLASH ? "launched" : null));
	const [snack, setSnack] = useState<string | null>(() => {
		const f = peekFlash();
		return f === LAUNCHED_FLASH ? null : f;
	});
	const [copyFailed, setCopyFailed] = useState(false);
	const [copied, setCopied] = useState(false);
	const [resplitOpen, setResplitOpen] = useState(false);
	const [groupMembers, setGroupMembers] = useState<SplitMember[] | null>(null);
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
	const [shareAction, setShareAction] = useState<{ uid: string; mode: "paid" | "pending" | "refund" } | null>(null);
	const [shareBusy, setShareBusy] = useState(false);
	const [shareError, setShareError] = useState<string | null>(null);
	// "Já paguei" / "Anexar comprovante" e o visualizador de comprovante (imagem).
	const [receiptSheet, setReceiptSheet] = useState<{ uid: string; mode: ReceiptMode } | null>(null);
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
				if (e instanceof ApiError) setError({ message: e.message, notFound: e.status === 404 });
				else setError({ message: "Não foi possível carregar a despesa.", notFound: false });
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
		(uid: string) => `/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/shares/${encodeURIComponent(uid)}/receipt`,
		[groupId, expenseId],
	);

	async function viewReceipt(uid: string) {
		const receipt = expense?.shares.find((s) => s.uid === uid)?.receipt;
		if (!receipt) return;
		if (!isImageType(receipt.contentType)) {
			try {
				await openBlobInNewTab(() => apiFetchBlob(receiptUrl(uid)), receipt.name, (u) => urls.current.push(u));
			} catch (e) {
				setSnack(e instanceof ApiError ? e.message : "Não foi possível abrir o comprovante.");
			}
			return;
		}
		setReceiptView({ name: receipt.name, url: null });
		try {
			const url = URL.createObjectURL(await apiFetchBlob(receiptUrl(uid)));
			urls.current.push(url);
			setReceiptView({ name: receipt.name, url });
		} catch (e) {
			setReceiptView(null);
			setSnack(e instanceof ApiError ? e.message : "Não foi possível abrir o comprovante.");
		}
	}

	function openReceiptSheet(uid: string, mode: ReceiptMode) {
		setReceiptError(null);
		setReceiptFileError(null);
		setReceiptSheet({ uid, mode });
	}

	async function submitReceipt(file: File | null) {
		if (!receiptSheet) return;
		const { uid, mode } = receiptSheet;
		setReceiptBusy(true);
		setReceiptError(null);
		setReceiptFileError(null);
		try {
			const body = new FormData();
			if (file) body.append("file", file);
			const updated = await apiFetch<ExpenseDetailData>(
				`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/shares/${encodeURIComponent(uid)}/payment`,
				{ method: "POST", body },
			);
			const next = normalizeExpense(updated);
			setExpense(next);
			setReceiptSheet(null);
			setSnack(receiptDoneMessage(mode));
			// Oferece avisar no WhatsApp, com o link da despesa (onde quem recebe vê o pagamento e o comprovante).
			const mine = next?.shares.find((x) => x.uid === uid);
			if (mine) {
				setPaidNotice({ amountCents: mine.amountCents, forName: mine.isYou ? null : mine.name, hasReceipt: !!mine.receipt });
				setShareOpen("paid");
			}
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				// A despesa mudou enquanto isso: fecha e mostra como está agora.
				setReceiptSheet(null);
				setSnack(e.message);
				setReloadKey((k) => k + 1);
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

	async function confirmShare() {
		if (!shareAction || !expense) return;
		const target = expense.shares.find((s) => s.uid === shareAction.uid);
		if (!target) return;
		setShareBusy(true);
		setShareError(null);
		try {
			const updated = await apiFetch<ExpenseDetailData>(
				`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/shares/${encodeURIComponent(target.uid)}`,
				{ method: "PATCH", body: JSON.stringify({ status: shareAction.mode === "pending" ? "pending" : "paid" }) },
			);
			setExpense(normalizeExpense(updated));
			setShareAction(null);
			setSnack(
				shareAction.mode === "refund"
					? `Devolução para ${target.name} registrada.`
					: shareAction.mode === "paid"
						? `Parte de ${target.name} marcada como paga.`
						: `Marcação de ${target.name} desfeita.`,
			);
		} catch (e) {
			setShareError(e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo.");
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

	if (error) {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title={error.notFound ? "Despesa não encontrada" : "Ops!"}
				action={
					<>
						{!error.notFound && (
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
						<Button href={`/app/grupos/${encodeURIComponent(groupId)}`} variant={error.notFound ? "filled" : "outlined"}>
							Voltar para o grupo
						</Button>
					</>
				}
			>
				{error.notFound ? "Essa despesa não existe mais ou você não faz parte do grupo." : error.message}
			</EmptyState>
		);
	}
	if (!expense) return <ExpenseDetailSkeleton />;

	const viewed = attachments.find((a) => a.id === viewing);
	const shareTarget = shareAction ? expense.shares.find((s) => s.uid === shareAction.uid) : undefined;
	const shareLink = buildExpenseLink(window.location.origin, groupId, expenseId);
	const shareText =
		shareOpen === "paid" && paidNotice
			? buildPaidShareText({ ...paidNotice, description: expense.description }, shareLink)
			: buildExpenseShareText(expense, shareLink);
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
				onCopyCode={(uid) => {
					const target = expense.shares.find((s) => s.uid === uid);
					const code = target ? payloadFor(expense, target.dueCents) : null;
					if (!code || !target) return;
					void copyText(code).then((ok) => {
						setCodeFallback(ok ? null : uid);
						if (ok) setSnack(target.youManage ? `Código Pix da parte de ${target.name} copiado! Agora cole no app do banco.` : "Código Pix copiado! Agora cole no app do seu banco.");
					});
				}}
				onCopyKey={() => {
					void copyText(expense.pix.key).then((ok) => setSnack(ok ? "Chave Pix copiada!" : "Não deu para copiar. Selecione a chave e copie."));
				}}
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
				onGiveBack={(uid) => openShare(uid, "refund")}
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
			/>

			<Sheet
				open={!!receiptSheet}
				onClose={() => {
					if (!receiptBusy) setReceiptSheet(null);
				}}
				title={receiptSheet ? receiptSheetCopy(receiptSheet.mode, expense.pix.payeeName).title : ""}
			>
				{receiptSheet && (
					<ReceiptSheetBody
						key={`${receiptSheet.uid}-${receiptSheet.mode}`}
						mode={receiptSheet.mode}
						payeeName={expense.pix.payeeName}
						busy={receiptBusy}
						error={receiptError}
						fileError={receiptFileError}
						onSubmit={(f) => void submitReceipt(f)}
						onCancel={() => setReceiptSheet(null)}
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
				title={shareOpen === "paid" ? "Avisar no WhatsApp" : shareOpen === "manual" ? "Avisar o grupo" : LAUNCHED_FLASH}
			>
				<ShareExpenseContent
					text={shareText}
					intro={
						shareOpen === "paid"
							? `Mande para ${expense.paidBy.name} saber que você pagou. O link abre a despesa${paidNotice?.hasReceipt ? " com o seu comprovante" : ""}.`
							: shareIntro(shareOpen === "manual" ? "manual" : "launched", expense.installment?.count)
					}
					canShare={canNativeShare}
					copyFailed={copyFailed}
					dismissLabel={shareOpen === "manual" ? "Fechar" : "Agora não"}
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
				title={shareAction && shareTarget ? sharePaidTitle(shareAction.mode, shareTarget) : ""}
			>
				{shareAction && shareTarget && (
					<SharePaidContent
						mode={shareAction.mode}
						selfReported={shareTarget.method === "self"}
						busy={shareBusy}
						error={shareError}
						onConfirm={() => void confirmShare()}
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
