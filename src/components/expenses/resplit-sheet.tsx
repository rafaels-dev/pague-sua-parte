"use client";

import { useMemo } from "react";
import { Banner, Button, Card, Skeleton } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { previewResplit, sameParticipants } from "@/lib/ui/resplit";
import type { ExpenseDetailData } from "./types";
import { WhoSplits, type SplitMember, type SplitMode } from "./who-splits";

/** Junta os nomes do grupo com quem já está na despesa (quem saiu do grupo continua aparecendo). */
export function splitMembersFor(expense: ExpenseDetailData, members: SplitMember[]): SplitMember[] {
	const known = new Set(members.map((m) => m.uid));
	const extra = expense.shares
		.filter((s) => !known.has(s.uid) && s.participates)
		.map((s) => ({ uid: s.uid, name: s.name, picture: s.picture, isYou: s.isYou }));
	return [...members, ...extra];
}

/** Conteúdo do sheet "Mudar quem divide": quem divide, "Como fica" e o botão Recalcular. */
export function ResplitContent({
	expense,
	members,
	selected,
	mode,
	busy,
	error,
	onMode,
	onToggle,
	onConfirm,
	onCancel,
}: Readonly<{
	expense: ExpenseDetailData;
	/** Pessoas do grupo; null enquanto carrega. */
	members: SplitMember[] | null;
	selected: string[];
	mode: SplitMode;
	busy: boolean;
	error: string | null;
	onMode: (m: SplitMode) => void;
	onToggle: (uid: string) => void;
	onConfirm: () => void;
	onCancel: () => void;
}>) {
	const all = useMemo(() => (members ? splitMembersFor(expense, members) : []), [expense, members]);
	const preview = useMemo(
		() =>
			previewResplit({
				amountCents: expense.amountCents,
				payerUid: expense.paidBy.uid,
				shares: expense.shares.map((s) => ({ uid: s.uid, name: s.isYou ? "Você" : s.name, amountCents: s.amountCents, paidCents: s.paidCents, participates: s.participates })),
				members: all.map((m) => ({ uid: m.uid, name: m.isYou ? "Você" : m.name })),
				newParticipantUids: selected,
			}),
		[expense, all, selected],
	);
	const unchanged = sameParticipants(selected, expense.participantUids);
	const canConfirm = !!members && preview.kind === "ok" && !unchanged && !busy;

	return (
		<div className="space-y-5">
			<p className="text-body-large text-on-surface-variant">
				O total de {formatBRL(expense.amountCents)} é dividido por igual entre as pessoas escolhidas. Quem já pagou a mais recebe a diferença de volta.
			</p>

			{members ? (
				<WhoSplits members={all} selected={selected} mode={mode} onMode={onMode} onToggle={onToggle} showAloneHint />
			) : (
				<div role="status" className="space-y-3">
					<span className="sr-only">Carregando...</span>
					<Skeleton className="h-12 rounded-full" />
					<Skeleton className="h-12 w-2/3 rounded-full" />
				</div>
			)}

			<Card tone="high" className="space-y-2 p-4" aria-live="polite">
				<h3 className="text-title-medium">Como fica</h3>
				{preview.kind === "empty" && <p className="text-body-large text-on-surface-variant">Marque pelo menos uma pessoa.</p>}
				{preview.kind === "error" && (
					<p role="alert" className="text-body-large text-error">
						{preview.message}
					</p>
				)}
				{preview.kind === "ok" && (
					<>
						<p className="money text-title-large">
							{selected.length === 1 ? `Fica ${formatBRL(preview.base)} para uma pessoa` : `Fica ${formatBRL(preview.base)} para cada um`}
						</p>
						{unchanged || preview.lines.length === 0 ? (
							<p className="text-body-large text-on-surface-variant">
								{unchanged ? "Ainda não mudou nada. Marque ou desmarque pessoas." : "Ninguém precisa pagar ou receber algo a mais."}
							</p>
						) : (
							<ul className="space-y-2">
								{preview.lines.map((l) => (
									<li key={l.uid} className="break-words text-body-large">
										<span className="font-medium">{l.name}:</span> <span className="text-on-surface-variant">{l.detail}</span>
									</li>
								))}
							</ul>
						)}
						{preview.refundTotalCents > 0 && (
							<p className="border-t border-outline-variant pt-2 text-body-large">
								Você vai precisar devolver <span className="money font-medium">{formatBRL(preview.refundTotalCents)}</span> no total.
							</p>
						)}
					</>
				)}
			</Card>

			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}

			<div className="sticky bottom-0 z-10 -mx-6 flex flex-col gap-3 border-t border-outline-variant bg-surface-container-low px-6 pb-1 pt-3">
				<Button onClick={onConfirm} loading={busy} disabled={!canConfirm && !busy} fullWidth icon={busy ? undefined : "check"}>
					{busy ? "Recalculando..." : "Recalcular"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Cancelar
				</Button>
			</div>
		</div>
	);
}
