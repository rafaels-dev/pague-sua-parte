"use client";

import { Banner, Button, FilterChip, MoneyField, Skeleton } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { advanceShortcuts, checkAdvance, OTHER_RECIPIENT_NOTE, type AdvancePlanData } from "@/lib/ui/advance";

/**
 * Conteúdo (visual) da folha "Adiantar parcelas ou pagar outro valor" de uma compra parcelada.
 * `mode: "self"` = quem deve vai pagar (Pix e "Já paguei"); `mode: "manual"` = quem pagou a despesa (ou o administrador)
 * registra o que recebeu. A prévia é calculada na hora pela MESMA função que o servidor usa para gravar; o servidor nunca
 * aceita a divisão que a tela mostra, só o valor e o total que a tela viu.
 */
export function AdvanceContent({
	mode,
	plan,
	loadError,
	personName,
	payeeName,
	cents,
	hasPix,
	canCopy,
	busy,
	error,
	onCents,
	onCopy,
	onCopyKey,
	onConfirm,
	onCancel,
	onRetry,
}: Readonly<{
	mode: "self" | "manual";
	/** null = ainda carregando. */
	plan: AdvancePlanData | null;
	loadError?: string | null;
	/** De quem é a parte (usado no texto de quem recebe). */
	personName: string;
	payeeName: string;
	/** Valor digitado (centavos; 0 = vazio). */
	cents: number;
	hasPix: boolean;
	canCopy: boolean;
	busy?: boolean;
	error?: string | null;
	onCents: (cents: number) => void;
	onCopy: () => void;
	onCopyKey?: () => void;
	/** "Já paguei" (segue para o comprovante) ou "Sim, recebi" (grava na hora). */
	onConfirm: () => void;
	onCancel: () => void;
	onRetry?: () => void;
}>) {
	const self = mode === "self";
	if (loadError) {
		return (
			<div className="space-y-4">
				<Banner tone="error" icon="error" role="alert">
					{loadError}
				</Banner>
				<div className="flex flex-col gap-3">
					{onRetry && (
						<Button icon="refresh" fullWidth onClick={onRetry}>
							Tentar de novo
						</Button>
					)}
					<Button variant="text" fullWidth onClick={onCancel}>
						Fechar
					</Button>
				</div>
			</div>
		);
	}
	if (!plan) {
		return (
			<div className="space-y-3" role="status" aria-label="Carregando as parcelas">
				<Skeleton className="h-6 w-3/4" />
				<Skeleton className="h-6 w-1/2" />
				<Skeleton className="h-20 w-full" />
			</div>
		);
	}
	if (plan.items.length === 0) {
		return (
			<div className="space-y-4">
				<p role="status" className="text-body-large text-on-surface">
					Tudo pago nesta compra.
				</p>
				<Button variant="tonal" fullWidth onClick={onCancel}>
					Fechar
				</Button>
			</div>
		);
	}
	const check = checkAdvance(plan, cents);
	const ok = check.kind === "ok";
	const shortcuts = advanceShortcuts(plan);
	const asking = self ? "Quanto você vai pagar?" : `Quanto ${personName} pagou?`;
	return (
		<div className="space-y-5">
			<p className="text-body-large text-on-surface-variant">
				{self ? "Faltam" : "Falta receber"} <strong className="money text-on-surface">{formatBRL(plan.totalDueCents)}</strong> {plan.moreRecipients && plan.recipient ? `para ${plan.recipient.name}` : "nesta compra"}.
			</p>
			{plan.moreRecipients && <p className="text-body-large text-on-surface-variant">{OTHER_RECIPIENT_NOTE}</p>}
			{shortcuts.length > 0 && (
				<div role="group" aria-label="Valores prontos" className="flex flex-wrap gap-2">
					{shortcuts.map((s) => (
						<FilterChip key={s.key} selected={cents === s.cents} onToggle={() => onCents(s.cents)} className="pl-4">
							{s.label} · {formatBRL(s.cents)}
						</FilterChip>
					))}
				</div>
			)}
			<MoneyField
				id="adiantar-valor"
				label={asking}
				cents={cents}
				onChange={onCents}
				autoFocus
				error={check.kind === "too_much" ? check.message : null}
			/>
			{ok && (
				<p role="status" aria-live="polite" className="rounded-shape-md bg-secondary-container p-4 text-body-large text-on-secondary-container">
					{check.preview}
					{check.note && <span className="mt-2 block font-medium">{check.note}</span>}
				</p>
			)}
			{self && ok && hasPix && canCopy && (
				<div className="space-y-2">
					<Button icon="content_copy" fullWidth onClick={onCopy}>
						Copiar Pix Copia e Cola
					</Button>
					<p className="text-body-large text-on-surface-variant">
						Cole no app do seu banco e pague {formatBRL(cents)} para {plan.recipient?.name ?? payeeName}. Depois volte aqui e toque em “Já paguei”.
					</p>
				</div>
			)}
			{self && ok && hasPix && !canCopy && (
				<div className="space-y-2">
					<p className="text-body-large text-on-surface-variant">Não foi possível gerar o código Pix. Pague pela chave: digite {formatBRL(cents)} no app do seu banco.</p>
					{onCopyKey && (
						<Button icon="content_copy" fullWidth onClick={onCopyKey}>
							Copiar chave Pix
						</Button>
					)}
				</div>
			)}
			{self && ok && !hasPix && <p className="text-body-large text-on-surface-variant">Ainda não há chave Pix de {plan.recipient?.name ?? payeeName} no app. Se pagou de outro jeito, avise aqui.</p>}
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button variant={self && hasPix && (canCopy || onCopyKey) ? "tonal" : "filled"} icon="check" fullWidth disabled={!ok || busy} loading={busy} onClick={onConfirm}>
					{self ? (ok ? `Já paguei ${formatBRL(cents)}` : "Já paguei") : ok ? `Sim, recebi ${formatBRL(cents)}` : "Sim, recebi"}
				</Button>
				<Button variant="text" fullWidth disabled={busy} onClick={onCancel}>
					Cancelar
				</Button>
			</div>
		</div>
	);
}
