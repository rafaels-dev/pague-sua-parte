"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { ReceiptSheetBody } from "@/components/expenses/receipt-sheet";
import { Sheet, Snackbar } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-client";
import { copyText } from "@/lib/ui/clipboard";
import { useLocationSearch } from "@/lib/ui/use-location-search";
import { groupParam, normalizeScopeGroup, scopedApiUrl } from "@/lib/ui/group-scope";
import {
	buildPayAllShareText,
	batchRequestItems,
	itemKey,
	normalizeBatchResult,
	normalizePayables,
	payAllLink,
	payAllPayload,
	removePaid,
	selectedItems,
	selectedTotal,
	shareFieldsFor,
	toggleUnchecked,
	type PayableItem,
} from "@/lib/ui/pay-all";
import { receiptDoneMessage, receiptSheetCopy } from "@/lib/ui/receipts";
import { EMPTY_CARD, PayAllView, type CardState, type DoneBatch, type PayAllPageState } from "./pay-all-view";

const UNAVAILABLE = new Set([404, 501]);

/** Mensagem de "Pagar tudo" para mandar no WhatsApp, a partir do que foi pago. */
export function doneShareText(done: DoneBatch, origin: string): string {
	return buildPayAllShareText(
		{ totalCents: done.paidCents, hasReceipt: done.hasReceipt, ...shareFieldsFor(done.paidItems) },
		payAllLink(origin, done.paidItems),
	);
}

export function PayAllPage() {
	const { user } = useAuth();
	const [state, setState] = useState<PayAllPageState>({ kind: "loading" });
	const [reloadKey, setReloadKey] = useState(0);
	const [cards, setCards] = useState<Record<string, CardState>>({});
	const [receiptFor, setReceiptFor] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [shareFor, setShareFor] = useState<string | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);
	const [copied, setCopied] = useState(false);
	const [snack, setSnack] = useState<string | null>(null);
	// Aberta a partir de um grupo (?grupo=<id>): só as contas dele. undefined = ainda não leu o endereço.
	const search = useLocationSearch();
	const groupId = search === null ? undefined : groupParam(search);
	const [scope, setScope] = useState<{ id: string; name: string } | null>(null);

	useEffect(() => {
		if (!user || groupId === undefined) return;
		let cancelled = false;
		apiFetch<unknown>(scopedApiUrl("/api/me/payables", groupId))
			.then((raw) => {
				if (cancelled) return;
				setScope(normalizeScopeGroup(raw));
				const recipients = normalizePayables(raw);
				setState((s) => (s.kind === "ready" ? { ...s, recipients } : { kind: "ready", recipients, done: [] }));
			})
			.catch((e) => {
				if (cancelled) return;
				// Recarregando por baixo dos panos: mantém o que já está na tela.
				setState((s) => {
					if (s.kind === "ready") return s;
					if (e instanceof ApiError && !groupId && UNAVAILABLE.has(e.status)) return { kind: "unavailable" };
					return { kind: "error", message: e instanceof ApiError ? e.message : "Não foi possível carregar suas contas." };
				});
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId, reloadKey]);

	const recipients = state.kind === "ready" ? state.recipients : [];
	const card = (id: string): CardState => cards[id] ?? EMPTY_CARD;
	const patch = (id: string, p: Partial<CardState>) => setCards((c) => ({ ...c, [id]: { ...(c[id] ?? EMPTY_CARD), ...p } }));
	const find = (id: string) => recipients.find((r) => r.id === id);

	async function submit(file: File | null) {
		const r = receiptFor ? find(receiptFor) : undefined;
		if (!r) return;
		const chosen: PayableItem[] = selectedItems(r.items, card(r.id).unchecked);
		if (chosen.length === 0) return;
		setBusy(true);
		setError(null);
		setFileError(null);
		try {
			const body = new FormData();
			body.append("data", JSON.stringify({ items: batchRequestItems(chosen), recipientId: r.id }));
			if (file) body.append("file", file);
			const res = normalizeBatchResult(await apiFetch<unknown>("/api/me/payments", { method: "POST", body }));
			const paidKeys = new Set(res.paid.map(itemKey));
			const gone = new Set([...paidKeys, ...res.failed.filter((f) => f.reason !== "conflict").map(itemKey)]);
			const batch: DoneBatch = {
				id: res.batchId || `lote-${Date.now()}`,
				payeeName: r.payee.name,
				paidCents: res.totalPaidCents,
				paidItems: chosen.filter((i) => paidKeys.has(itemKey(i))),
				failed: res.failed.flatMap((f) => {
					const item = chosen.find((i) => itemKey(i) === itemKey(f));
					return item ? [{ item, reason: f.reason }] : [];
				}),
				hasReceipt: res.hasReceipt,
			};
			setState((s) => (s.kind === "ready" ? { kind: "ready", recipients: removePaid(s.recipients, gone), done: [batch, ...s.done] } : s));
			setReceiptFor(null);
			setSnack(receiptDoneMessage("batch"));
			setReloadKey((k) => k + 1); // confere com o servidor o que sobrou
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				// Tudo mudou enquanto isso: fecha e mostra a lista como está agora.
				setReceiptFor(null);
				setSnack(e.message);
				setReloadKey((k) => k + 1);
			} else if (e instanceof ApiError && e.status === 422 && e.field === "file") {
				setFileError(e.message);
			} else if (e instanceof ApiError && UNAVAILABLE.has(e.status)) {
				setError("Esta função ainda não está disponível. Tente de novo mais tarde.");
			} else {
				setError(e instanceof ApiError ? e.message : "Não foi possível enviar. Tente de novo.");
			}
		} finally {
			setBusy(false);
		}
	}

	const receiptRecipient = receiptFor ? find(receiptFor) : undefined;
	const receiptCount = receiptRecipient ? selectedItems(receiptRecipient.items, card(receiptRecipient.id).unchecked).length : 0;
	const doneToShare = state.kind === "ready" ? state.done.find((d) => d.id === shareFor) : undefined;
	const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
	const shareText = doneToShare ? doneShareText(doneToShare, window.location.origin) : "";
	const closeShare = () => {
		setShareFor(null);
		setCopyFailed(false);
		setCopied(false);
	};

	return (
		<>
			<PayAllView
				state={state}
				scope={scope}
				cards={cards}
				onToggleItem={(id, key) => patch(id, { unchecked: toggleUnchecked(card(id).unchecked, key), qrOpen: false, codeFallback: false })}
				onGenerate={(id) => {
					const r = find(id);
					if (r) patch(id, { pixCents: selectedTotal(r.items, card(id).unchecked), qrOpen: false, codeFallback: false });
				}}
				onToggleQr={(id) => patch(id, { qrOpen: !card(id).qrOpen })}
				onCopyCode={(id) => {
					const r = find(id);
					const code = r ? payAllPayload(r, selectedTotal(r.items, card(id).unchecked)) : null;
					if (!code) return;
					void copyText(code).then((ok) => {
						patch(id, { codeFallback: !ok });
						if (ok) setSnack("Código Pix copiado! Agora cole no app do seu banco.");
					});
				}}
				onCopyKey={(id) => {
					const r = find(id);
					if (r) void copyText(r.pix.key).then((ok) => setSnack(ok ? "Chave Pix copiada!" : "Não deu para copiar. Selecione a chave e copie."));
				}}
				onPaid={(id) => {
					setError(null);
					setFileError(null);
					setReceiptFor(id);
				}}
				onTell={setShareFor}
				onRetry={() => {
					setState({ kind: "loading" });
					setReloadKey((k) => k + 1);
				}}
			/>

			<Sheet
				open={!!receiptRecipient}
				onClose={() => {
					if (!busy) setReceiptFor(null);
				}}
				title={receiptSheetCopy("batch", "", receiptCount).title}
			>
				{receiptRecipient && (
					<ReceiptSheetBody
						key={receiptRecipient.id}
						mode="batch"
						payeeName={receiptRecipient.payee.name}
						count={receiptCount}
						busy={busy}
						error={error}
						fileError={fileError}
						onSubmit={(f) => void submit(f)}
						onCancel={() => setReceiptFor(null)}
					/>
				)}
			</Sheet>

			<Sheet open={!!doneToShare} onClose={closeShare} title="Avisar no WhatsApp">
				{doneToShare && (
					<ShareExpenseContent
						text={shareText}
						intro={`Mande para ${doneToShare.payeeName} saber que você pagou. O link abre ${doneToShare.paidItems.length > 0 && new Set(doneToShare.paidItems.map((i) => i.groupId)).size === 1 ? "o grupo" : "o app"}${doneToShare.hasReceipt ? ", com o seu comprovante" : ""}.`}
						canShare={canNativeShare}
						copyFailed={copyFailed}
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
				)}
				<Snackbar open={copied} message="Mensagem copiada!" onClose={() => setCopied(false)} />
			</Sheet>

			<Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} aboveNav />
		</>
	);
}
