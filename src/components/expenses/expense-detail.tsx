"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ActionChip, Avatar, Banner, Button, Card, EmptyState, Icon, List, Sheet, Skeleton, Snackbar, StatusChip } from "@/components/ui";
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { buildPixPayload } from "@/lib/pix/brcode";
import { copyText } from "@/lib/ui/clipboard";
import { formatDateLong, formatDateShort, todayISO } from "@/lib/ui/dates";
import { isImageType } from "@/lib/ui/attachments";
import { paidByLabel, shareStatusChip } from "@/lib/ui/expense-status";
import { ExpenseAttachments, type AttachmentView } from "./expense-attachments";
import { PixPayCard } from "./pix-pay-card";
import { clearFlash, peekFlash, setFlash, type ExpenseDetailData, type ExpenseShare } from "./types";

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

/** Linha de uma pessoa em "Quem participa". Para quem pagou a despesa, traz a ação de marcar/desfazer embaixo (cabe em 390px). */
function ShareRow({
	share: s,
	canMarkPaid,
	onMarkPaid,
	onUndoPaid,
}: Readonly<{ share: ExpenseShare; canMarkPaid: boolean; onMarkPaid: (uid: string) => void; onUndoPaid: (uid: string) => void }>) {
	const chip = shareStatusChip(s.status);
	const canAct = canMarkPaid && s.status !== "payer";
	const when = paidDateLabel(s.paidAt);
	return (
		<li className="px-4 py-3 text-on-surface">
			<div className="flex min-h-12 items-center gap-4">
				<Avatar name={s.name} src={s.picture} />
				<span className="min-w-0 flex-1">
					<span className="block break-words text-body-large font-medium">
						{s.name}
						{s.isYou && <span className="font-normal text-on-surface-variant"> (você)</span>}
					</span>
					<span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
						<StatusChip tone={chip.tone}>{chip.text}</StatusChip>
						{canAct && s.status === "pending" && (
							<ActionChip icon="check" onClick={() => onMarkPaid(s.uid)}>
								Marcar como pago
							</ActionChip>
						)}
						{canAct && s.status === "paid" && <ActionChip onClick={() => onUndoPaid(s.uid)}>Desfazer</ActionChip>}
					</span>
				</span>
				<span className="money shrink-0 text-title-medium">{formatBRL(s.amountCents)}</span>
			</div>
			{s.status === "paid" && s.method === "manual" && (
				<p className="ml-16 mt-1 text-sm text-on-surface-variant">
					Marcado por quem pagou a conta{when && ` · ${when}`}
				</p>
			)}
		</li>
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
}>) {
	const mine = expense.shares.find((s) => s.isYou);
	const owes = mine?.status === "pending";
	const youPaid = expense.paidBy.isYou;
	const stillOwe = expense.shares.filter((s) => s.status === "pending");
	const allPaid = stillOwe.length === 0;
	const payload = useMemo(() => (owes && mine ? payloadFor(expense, mine.amountCents) : null), [owes, mine, expense]);

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<header className="space-y-1">
				<h1 className="break-words text-headline-medium md:text-headline-large">{expense.description}</h1>
				<p className="money text-display-small font-bold">{formatBRL(expense.amountCents)}</p>
				<p className="text-body-large text-on-surface-variant">
					{paidByLabel(expense.paidBy)} · {formatDateLong(expense.date)}
				</p>
			</header>

			{owes && mine && (
				<PixPayCard
					shareCents={mine.amountCents}
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
							{allPaid ? "Tudo pago" : "Você pagou esta despesa"}
						</h2>
					</div>
					{stillOwe.length > 0 ? (
						<div>
							<p className="mb-1 text-body-large text-on-surface-variant">Ainda falta receber de:</p>
							<ul className="space-y-1">
								{stillOwe.map((s) => (
									<li key={s.uid} className="flex items-baseline justify-between gap-3 text-body-large">
										<span className="min-w-0 break-words font-medium">{s.name}</span>
										<span className="money shrink-0">{formatBRL(s.amountCents)}</span>
									</li>
								))}
							</ul>
						</div>
					) : (
						<p className="text-body-large">Todo mundo já pagou a sua parte.</p>
					)}
				</Card>
			)}

			<section className="space-y-3" aria-labelledby="quem-participa">
				<h2 id="quem-participa" className="text-title-large">
					Quem participa
				</h2>
				<List>
					{expense.shares.map((s) => (
						<ShareRow key={s.uid} share={s} canMarkPaid={expense.canMarkPaid} onMarkPaid={onMarkPaid} onUndoPaid={onUndoPaid} />
					))}
				</List>
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
	mode: "paid" | "pending";
	busy: boolean;
	error: string | null;
	onConfirm: () => void;
	onCancel: () => void;
}>) {
	const marking = mode === "paid";
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">
				{marking
					? "Use quando a pessoa pagou em dinheiro ou combinou de outra forma."
					: "A marcação de pago some e a parte volta a ficar em aberto."}
			</p>
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button onClick={onConfirm} loading={busy} disabled={busy} fullWidth>
					{marking ? (busy ? "Marcando..." : "Sim, marcar como pago") : busy ? "Desfazendo..." : "Sim, voltar para falta pagar"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Cancelar
				</Button>
			</div>
		</div>
	);
}

/** Título do sheet de confirmação. */
export function sharePaidTitle(mode: "paid" | "pending", share: Pick<ExpenseShare, "name" | "amountCents">): string {
	return mode === "paid" ? `${share.name} pagou ${formatBRL(share.amountCents)}?` : `Voltar a parte de ${share.name} para 'Falta pagar'?`;
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
	const [snack, setSnack] = useState<string | null>(() => peekFlash());
	const [blobs, setBlobs] = useState<Blobs>({});
	const [viewing, setViewing] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [shareAction, setShareAction] = useState<{ uid: string; mode: "paid" | "pending" } | null>(null);
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
				if (!cancelled) setExpense(d);
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
				{ method: "PATCH", body: JSON.stringify({ status: shareAction.mode }) },
			);
			setExpense(updated);
			setShareAction(null);
			setSnack(shareAction.mode === "paid" ? `Parte de ${target.name} marcada como paga.` : `Parte de ${target.name} voltou para falta pagar.`);
		} catch (e) {
			setShareError(e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo.");
		} finally {
			setShareBusy(false);
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
	const openShare = (uid: string, mode: "paid" | "pending") => {
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
					const code = mine ? payloadFor(expense, mine.amountCents) : null;
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
			/>

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
