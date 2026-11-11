"use client";

import { useState } from "react";
import { Banner, Button, Sheet, Snackbar, TextField } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { buildInviteLink, buildShareText, buildWhatsAppUrl } from "@/lib/ui/invite";

/** Conteúdo (visual) do sheet de convite: WhatsApp, copiar, compartilhar e gerar novo link. */
export function InviteSheetContent({
	link,
	groupName,
	isAdmin,
	busy,
	error,
	confirmingNew,
	copyFailed,
	canShare,
	onCopy,
	onShare,
	onAskNew,
	onCancelNew,
	onConfirmNew,
}: Readonly<{
	link: string;
	groupName: string;
	isAdmin: boolean;
	busy: boolean;
	error: string | null;
	confirmingNew: boolean;
	copyFailed: boolean;
	canShare: boolean;
	onCopy: () => void;
	onShare: () => void;
	onAskNew: () => void;
	onCancelNew: () => void;
	onConfirmNew: () => void;
}>) {
	if (confirmingNew) {
		return (
			<div className="space-y-4">
				<Banner>O link antigo vai parar de funcionar. Quem ainda não entrou precisará do novo link. Continuar?</Banner>
				{error && (
					<Banner tone="error" icon="error" role="alert">
						{error}
					</Banner>
				)}
				<div className="flex flex-col gap-3">
					<Button onClick={onConfirmNew} loading={busy} fullWidth>
						{busy ? "Gerando..." : "Sim, gerar novo link"}
					</Button>
					<Button variant="outlined" onClick={onCancelNew} disabled={busy} fullWidth>
						Cancelar
					</Button>
				</div>
			</div>
		);
	}

	const text = buildShareText(groupName, link);
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">Envie para quem você quer chamar. O link vale por 7 dias.</p>
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button href={buildWhatsAppUrl(text)} target="_blank" rel="noopener noreferrer" icon="share" fullWidth>
					Enviar pelo WhatsApp
				</Button>
				<Button variant="tonal" icon="content_copy" onClick={onCopy} fullWidth>
					Copiar link
				</Button>
				{canShare && (
					<Button variant="outlined" icon="share" onClick={onShare} fullWidth>
						Compartilhar de outro jeito
					</Button>
				)}
			</div>
			{copyFailed && (
				<TextField
					label="Link do convite"
					readOnly
					value={link}
					supportingText="Não deu para copiar sozinho. Toque no link, selecione e copie."
					onFocus={(e) => e.currentTarget.select()}
					onClick={(e) => e.currentTarget.select()}
				/>
			)}
			{isAdmin && (
				<Button variant="text" icon="refresh" onClick={onAskNew} size="md" fullWidth>
					Gerar novo link
				</Button>
			)}
		</div>
	);
}

export function InvitePanel({ groupId, groupName, isAdmin }: Readonly<{ groupId: string; groupName: string; isAdmin: boolean }>) {
	const [link, setLink] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const [confirmingNew, setConfirmingNew] = useState(false);
	const [renewed, setRenewed] = useState(false);

	const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

	async function share(url: string) {
		if (typeof navigator === "undefined" || typeof navigator.share !== "function") return;
		try {
			await navigator.share({ text: buildShareText(groupName, url) });
		} catch {
			// Cancelou ou o navegador recusou: os botões do sheet continuam disponíveis.
		}
	}

	async function createInvite(regenerate: boolean) {
		setBusy(true);
		setError(null);
		setCopied(false);
		setCopyFailed(false);
		try {
			const res = await apiFetch<{ token: string }>(`/api/groups/${encodeURIComponent(groupId)}/invite`, {
				method: "POST",
				body: JSON.stringify(regenerate ? { regenerate: true } : {}),
			});
			const url = buildInviteLink(window.location.origin, res.token);
			setLink(url);
			setConfirmingNew(false);
			setRenewed(regenerate);
			setOpen(true);
			if (!regenerate) await share(url);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Não foi possível criar o convite. Tente de novo.");
		} finally {
			setBusy(false);
		}
	}

	async function copy() {
		if (!link) return;
		setCopyFailed(false);
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
		} catch {
			setCopied(false);
			setCopyFailed(true);
		}
	}

	function close() {
		setOpen(false);
		setConfirmingNew(false);
		setError(null);
	}

	return (
		<section className="space-y-3" aria-label="Convidar pessoas">
			<Button icon="share" loading={busy && !open} onClick={() => void createInvite(false)} disabled={busy} fullWidth className="md:w-auto">
				{busy && !link ? "Criando convite..." : "Convidar pessoas"}
			</Button>

			{error && !open && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}

			<Sheet open={open && !!link} onClose={close} title={renewed ? "Novo link pronto!" : "Convite pronto!"}>
				{link && (
					<InviteSheetContent
						link={link}
						groupName={groupName}
						isAdmin={isAdmin}
						busy={busy}
						error={error}
						confirmingNew={confirmingNew}
						copyFailed={copyFailed}
						canShare={canShare}
						onCopy={() => void copy()}
						onShare={() => void share(link)}
						onAskNew={() => setConfirmingNew(true)}
						onCancelNew={() => setConfirmingNew(false)}
						onConfirmNew={() => void createInvite(true)}
					/>
				)}
				<Snackbar open={copied} message="Link copiado!" onClose={() => setCopied(false)} />
			</Sheet>
		</section>
	);
}
