"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { Sheet, Snackbar } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-client";
import { copyText } from "@/lib/ui/clipboard";
import { useLocationSearch } from "@/lib/ui/use-location-search";
import { groupParam, normalizeScopeGroup, scopedApiUrl } from "@/lib/ui/group-scope";
import { buildCollectText, collectLink, firstName, normalizeReceivables, type Debtor } from "@/lib/ui/receivables";
import { ReceivablesView, type ReceivablesPageState } from "./receivables-view";

const UNAVAILABLE = new Set([404, 501]);

/** Mensagem de cobrança de um devedor, com o link certo (grupo único ou início do app). */
export function collectShareText(debtor: Debtor, origin: string): string {
	return buildCollectText(debtor, collectLink(origin, debtor.items));
}

/** Texto de apoio do sheet "Cobrar no WhatsApp". */
export function collectIntro(debtor: Debtor): string {
	const to = debtor.kind === "managed" && debtor.managedByName ? firstName(debtor.managedByName) : firstName(debtor.name);
	const one = new Set(debtor.items.map((i) => i.groupId)).size === 1;
	return `Mande para ${to || "a pessoa"} lembrar do que falta. O link abre ${one ? "o grupo" : "o app"}.`;
}

export function ReceivablesPage() {
	const { user } = useAuth();
	const [state, setState] = useState<ReceivablesPageState>({ kind: "loading" });
	const [reloadKey, setReloadKey] = useState(0);
	const [shareFor, setShareFor] = useState<string | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);
	const [copied, setCopied] = useState(false);
	// Aberta a partir de um grupo (?grupo=<id>): só o que devem nele. undefined = ainda não leu o endereço.
	const search = useLocationSearch();
	const groupId = search === null ? undefined : groupParam(search);
	const [scope, setScope] = useState<{ id: string; name: string } | null>(null);

	useEffect(() => {
		if (!user || groupId === undefined) return;
		let cancelled = false;
		apiFetch<unknown>(scopedApiUrl("/api/me/receivables", groupId))
			.then((raw) => {
				if (cancelled) return;
				setScope(normalizeScopeGroup(raw));
				setState({ kind: "ready", data: normalizeReceivables(raw) });
			})
			.catch((e) => {
				if (cancelled) return;
				if (e instanceof ApiError && !groupId && UNAVAILABLE.has(e.status)) setState({ kind: "unavailable" });
				else setState({ kind: "error", message: e instanceof ApiError ? e.message : "Não foi possível carregar. Tente de novo." });
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId, reloadKey]);

	const debtor = state.kind === "ready" ? state.data.debtors.find((d) => d.uid === shareFor) : undefined;
	const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
	const shareText = debtor ? collectShareText(debtor, window.location.origin) : "";
	const closeShare = () => {
		setShareFor(null);
		setCopyFailed(false);
		setCopied(false);
	};

	return (
		<>
			<ReceivablesView
				state={state}
				scope={scope}
				onCollect={setShareFor}
				onRetry={() => {
					setState({ kind: "loading" });
					setReloadKey((k) => k + 1);
				}}
			/>
			<Sheet open={!!debtor} onClose={closeShare} title="Cobrar no WhatsApp">
				{debtor && (
					<ShareExpenseContent
						text={shareText}
						intro={collectIntro(debtor)}
						whatsappLabel="Cobrar no WhatsApp"
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
		</>
	);
}
