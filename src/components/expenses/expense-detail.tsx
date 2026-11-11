"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ActionChip, Avatar, Banner, Button, Card, EmptyState, Icon, List, Sheet, Skeleton, Snackbar, StatusChip } from "@/components/ui";
import type { Group } from "@/components/groups/group-detail";
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { buildPixPayload } from "@/lib/pix/brcode";
import { copyText } from "@/lib/ui/clipboard";
import { formatDateLong, formatDateShort, todayISO } from "@/lib/ui/dates";
import { isImageType } from "@/lib/ui/attachments";
import { buildExpenseLink, buildExpenseShareText } from "@/lib/ui/expense-share";
import { paidByLabel, shareStatusChip } from "@/lib/ui/expense-status";
import { ExpenseAttachments, type AttachmentView } from "./expense-attachments";
import { ShareExpenseContent } from "./expense-share";
import { PixPayCard } from "./pix-pay-card";
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
}: Readonly<{
	share: ExpenseShare;
	canMarkPaid: boolean;
	onMarkPaid: (uid: string) => void;
	onUndoPaid: (uid: string) => void;
	onGiveBack: (uid: string) => void;
}>) {
	const chip = shareStatusChip(s.status, s);
	const canAct = canMarkPaid && s.status !== "payer";
	const when = paidDateLabel(s.paidAt);
	return (
		<li className="px-4 py-3 text-on-surface">
			<div className="flex min-h-12 items-center gap-4">
				<Avatar name={s.name} src={s.picture} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-3">
						<span className="min-w-0 break-words text-body-large font-medium">
							{s.name}
							{s.isYou && <span className="font-normal text-on-surface-variant"> (você)</span>}
						</span>
						{s.participates && <span className="money shrink-0 text-title-medium">{formatBRL(s.amountCents)}</span>}
					</div>
					<span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
						<StatusChip tone={chip.tone}>{chip.text}</StatusChip>
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
						{canAct && s.status === "paid" && <ActionChip onClick={() => onUndoPaid(s.uid)}>Desfazer</ActionChip>}
					</span>
				</div>
			</div>
			{s.status === "paid" && s.method === "manual" && (
				<p className="ml-16 mt-1 text-sm text-on-surface-variant">
					{s.participates ? "Marcado por quem pagou a conta" : "Devolução marcada por quem pagou a conta"}
					{when && ` · ${when}`}
				</p>
			)}
		</li>
	);
}

/** O que a pessoa vê sobre a própria parte quando já não precisa pagar nada: a receber de volta ou tudo pago. */
function YourPartCard({ share, ownerName }: Readonly<{ share: ExpenseShare; ownerName: string }>) {
	const refund = share.status === "refund";
	return (
		<Card as="section" tone="high" aria-labelledby="sua-parte-situacao" className="flex items-start gap-3 bg-primary-container! p-5 text-on-primary-container">
			<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
				<Icon name="check" />
			</span>
			<div className="min-w-0">
				<h2 id="sua-parte-situacao" className="text-title-large">
					{refund ? "A receber de volta" : "Sua parte está paga"}
				</h2>
				{refund && (
					<p className="text-body-large">
						Você pagou {formatBRL(share.refundCents)} a mais. {ownerName} vai te devolver.
					</p>
				)}
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
}: Readonly<{
	expense: ExpenseDetailData;
	attachments: AttachmentView[];
	qrOpen: boolean;
	codeFallback: boolean;
	onToggleQr: () => void;
	onCopyCode: () => void;
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
}>) {
	const mine = expense.shares.find((s) => s.isYou);
	const owes = mine?.status === "pending";
	const youPaid = expense.paidBy.isYou;
	const stillOwe = expense.shares.filter((s) => s.status === "pending");
	const toReturn = expense.shares.filter((s) => s.status === "refund");
	const allPaid = stillOwe.length === 0 && toReturn.length === 0;
	const payDue = mine ? mine.dueCents : 0;
	const payload = useMemo(() => (owes && mine ? payloadFor(expense, payDue) : null), [owes, mine, expense, payDue]);
	const inSplit = expense.shares.filter((s) => s.participates);
	const left = expense.shares.filter((s) => !s.participates);
	const row = (s: ExpenseShare) => (
		<ShareRow key={s.uid} share={s} canMarkPaid={expense.canMarkPaid} onMarkPaid={onMarkPaid} onUndoPaid={onUndoPaid} onGiveBack={onGiveBack} />
	);

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<header className="space-y-1">
				<h1 className="break-words text-headline-medium md:text-headline-large">{expense.description}</h1>
				<p className="money text-display-small font-bold">{formatBRL(expense.amountCents)}</p>
				<p className="text-body-large text-on-surface-variant">
					{paidByLabel(expense.paidBy)} · {formatDateLong(expense.date)}
				</p>
				<Button variant="text" size="md" icon="share" onClick={onShare} className="-ml-4">
					Avisar no WhatsApp
				</Button>
			</header>

			{owes && mine && (
				<PixPayCard
					shareCents={payDue}
					paidSoFarCents={mine.paidCents}
					payeeName={expense.pix.payeeName}
					pix={expense.pix}
					payload={payload}
					qrOpen={qrOpen}
					codeFallback={codeFallback}
					onToggleQr={onToggleQr}
					onCopyCode={onCopyCode}
					onCopyKey={onCopyKey}
				/>
			)}

			{!youPaid && mine && (mine.status === "refund" || (mine.status === "paid" && mine.participates)) && (
				<YourPartCard share={mine} ownerName={expense.paidBy.name} />
			)}

			{youPaid && (
				<Card
					as="section"
					tone="high"
					aria-labelledby="voce-pagou"
					className={`space-y-3 p-5 ${allPaid ? "bg-primary-container! text-on-primary-container" : ""}`}
				>
					<div className="flex items-center gap-3">
						<span
							className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
								allPaid ? "bg-primary text-on-primary" : "bg-primary-container text-on-primary-container"
							}`}
						>
							<Icon name="check" />
						</span>
						<h2 id="voce-pagou" className="text-title-large">
							{allPaid ? "Tudo certo" : "Você pagou esta despesa"}
						</h2>
					</div>
					{stillOwe.length > 0 && (
						<div>
							<p className="mb-1 text-body-large text-on-surface-variant">Ainda falta receber de:</p>
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
							<p className="mb-1 text-body-large text-on-surface-variant">Você precisa devolver para:</p>
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
					{allPaid && <p className="text-body-large">Todo mundo pagou a sua parte e não há nada a devolver.</p>}
				</Card>
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
						Apagar despesa
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
	busy,
	error,
	onConfirm,
	onCancel,
}: Readonly<{
	mode: "paid" | "pending" | "refund";
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
	share: Pick<ExpenseShare, "name" | "amountCents" | "dueCents" | "refundCents">,
): string {
	if (mode === "refund") return `Você devolveu ${formatBRL(share.refundCents)} para ${share.name}?`;
	if (mode === "paid") return `${share.name} pagou ${formatBRL(share.dueCents > 0 ? share.dueCents : share.amountCents)}?`;
	return `Desfazer a marcação de ${share.name}?`;
}

type Blobs = Record<string, { url: string | null; state: "loading" | "ready" | "error" }>;

export function ExpenseDetail({ groupId, expenseId }: Readonly<{ groupId: string; expenseId: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [expense, setExpense] = useState<ExpenseDetailData | null>(null);
	const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [qrOpen, setQrOpen] = useState(false);
	const [codeFallback, setCodeFallback] = useState(false);
	// Recém lançada: em vez do recadinho, abrimos o sheet "Avisar o grupo".
	const [shareOpen, setShareOpen] = useState<"launched" | "manual" | null>(() => (peekFlash() === LAUNCHED_FLASH ? "launched" : null));
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
	const [shareAction, setShareAction] = useState<{ uid: string; mode: "paid" | "pending" | "refund" } | null>(null);
	const [shareBusy, setShareBusy] = useState(false);
	const [shareError, setShareError] = useState<string | null>(null);
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
		// Abrimos a aba já no toque (senão o navegador bloqueia) e só depois colocamos o arquivo nela.
		const tab = window.open("", "_blank");
		try {
			const blob = await apiFetchBlob(attachmentUrl(aid));
			const url = URL.createObjectURL(blob);
			urls.current.push(url);
			if (tab) {
				tab.opener = null;
				tab.location.href = url;
			} else {
				const a = document.createElement("a");
				a.href = url;
				a.download = expense?.attachments.find((x) => x.id === aid)?.name ?? "anexo.pdf";
				a.click();
			}
		} catch (e) {
			tab?.close();
			setSnack(e instanceof ApiError ? e.message : "Não foi possível abrir o PDF.");
		}
	}

	async function remove() {
		setDeleting(true);
		setDeleteError(null);
		try {
			await apiFetch(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`, { method: "DELETE" });
			setFlash("Despesa apagada.");
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

	function openResplit() {
		if (!expense) return;
		setResplitError(null);
		setResplitSelected(expense.participantUids);
		setResplitMode("choose");
		setResplitOpen(true);
		if (!groupMembers) {
			apiFetch<Group>(`/api/groups/${encodeURIComponent(groupId)}`)
				.then((g) => {
					const list = g.members.map((m) => ({ uid: m.uid, name: m.name, picture: m.picture, isYou: m.isYou }));
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
				{ method: "PUT", body: JSON.stringify({ participantUids: resplitSelected }) },
			);
			setExpense(normalizeExpense(updated));
			setResplitOpen(false);
			setSnack("Divisão atualizada.");
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

	const mine = expense.shares.find((s) => s.isYou);
	const viewed = attachments.find((a) => a.id === viewing);
	const shareTarget = shareAction ? expense.shares.find((s) => s.uid === shareAction.uid) : undefined;
	const shareLink = buildExpenseLink(window.location.origin, groupId, expenseId);
	const shareText = buildExpenseShareText(expense, shareLink);
	const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
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
				onToggleQr={() => setQrOpen((o) => !o)}
				onCopyCode={() => {
					const code = mine ? payloadFor(expense, mine.dueCents) : null;
					if (!code) return;
					void copyText(code).then((ok) => {
						setCodeFallback(!ok);
						if (ok) setSnack("Código Pix copiado! Agora cole no app do seu banco.");
					});
				}}
				onCopyKey={() => {
					void copyText(expense.pix.key).then((ok) => setSnack(ok ? "Chave Pix copiada!" : "Não deu para copiar. Selecione a chave e copie."));
				}}
				onOpenImage={(id) => setViewing(id)}
				onOpenPdf={(id) => void openPdf(id)}
				onAskDelete={() => {
					setDeleteError(null);
					setConfirmingDelete(true);
				}}
				onMarkPaid={(uid) => openShare(uid, "paid")}
				onUndoPaid={(uid) => openShare(uid, "pending")}
				onGiveBack={(uid) => openShare(uid, "refund")}
				onEditParticipants={openResplit}
				onShare={() => setShareOpen("manual")}
			/>

			<Sheet
				open={shareOpen !== null}
				onClose={closeShare}
				title={shareOpen === "manual" ? "Avisar o grupo" : LAUNCHED_FLASH}
			>
				<ShareExpenseContent
					text={shareText}
					intro={shareOpen === "manual" ? "Mande o link para cada um pagar a sua parte." : "Avise o grupo para cada um pagar a sua parte."}
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

			<Sheet
				open={confirmingDelete}
				onClose={() => {
					if (!deleting) setConfirmingDelete(false);
				}}
				title="Apagar esta despesa?"
			>
				<DeleteExpenseContent busy={deleting} error={deleteError} onConfirm={() => void remove()} onCancel={() => setConfirmingDelete(false)} />
			</Sheet>

			<Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} aboveNav />
		</>
	);
}
