"use client";

import { Avatar, Banner, Button, Card, Icon } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { cx } from "@/lib/ui/cx";
import type { ExpenseDetailData } from "./types";

/** Quem pode ser a pessoa que ajuda: você e/ou as pessoas sem celular que você cuida. */
export type HelperOption = { uid: string; name: string; isYou: boolean; picture: string | null };

/** Código de "Eu" na lista de quem ajuda (a API não precisa dele: sem `forUid` é você). */
export const ME_UID = "eu";

/** Pode ajudar: ou você, ou alguém que você cuida. */
export function canHelpOn(e: Pick<ExpenseDetailData, "canHelp" | "helpAsUids">): boolean {
	return e.canHelp || e.helpAsUids.length > 0;
}

/**
 * Quem pode ajudar nesta despesa: você (se puder) e as pessoas que você cuida.
 * `names` traz os nomes pelas pessoas do grupo (a API manda só os códigos).
 */
export function helperOptions(e: ExpenseDetailData, names: Record<string, { name: string; picture: string | null }>): HelperOption[] {
	const list: HelperOption[] = [];
	if (e.canHelp) {
		list.push({ uid: ME_UID, name: "Eu", isYou: true, picture: null });
	}
	for (const uid of e.helpAsUids) {
		const known = names[uid] ?? e.shares.find((s) => s.uid === uid);
		list.push({ uid, name: known?.name ?? "Pessoa que você cuida", isYou: false, picture: known?.picture ?? null });
	}
	return list;
}

/** Cartão no alto da despesa: convida a entrar na divisão. */
export function HelpCard({ expense, onHelp }: Readonly<{ expense: ExpenseDetailData; onHelp: () => void }>) {
	const title = expense.ownerAlone ? `${expense.paidBy.name} está arcando com esta despesa sozinho(a)` : "Quer ajudar a dividir esta despesa?";
	return (
		<Card as="section" tone="high" aria-labelledby="quero-ajudar" className="space-y-4 bg-primary-container! p-5 text-on-primary-container">
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
					<Icon name="favorite" />
				</span>
				<div className="min-w-0">
					<h2 id="quero-ajudar" className="break-words text-title-large">
						{title}
					</h2>
					<p className="mt-1 text-body-large">
						{expense.ownerAlone
							? "Se você entrar na divisão, a parte de cada um diminui e quem pagou recebe de volta."
							: "Entrando na divisão, a parte de cada um diminui."}
					</p>
				</div>
			</div>
			<Button icon="favorite" fullWidth onClick={onHelp}>
				Quero ajudar
			</Button>
		</Card>
	);
}

/** Conteúdo (visual) do sheet "Quero ajudar". */
export function HelpContent({
	expense,
	options,
	who,
	busy,
	error,
	onWho,
	onConfirm,
	onCancel,
}: Readonly<{
	expense: ExpenseDetailData;
	options: HelperOption[];
	/** Código de quem vai ajudar. */
	who: string;
	busy: boolean;
	error: string | null;
	onWho: (uid: string) => void;
	onConfirm: () => void;
	onCancel: () => void;
}>) {
	const chosen = options.find((o) => o.uid === who) ?? options[0];
	const forOther = !!chosen && !chosen.isYou;
	const share = expense.helpShareCents;
	const payer = expense.paidBy.name;
	return (
		<div className="space-y-5">
			{options.length > 1 && (
				<div role="radiogroup" aria-label="Quem vai ajudar?" className="space-y-2">
					<p className="text-title-medium">Quem vai ajudar?</p>
					{options.map((o) => {
						const selected = o.uid === chosen?.uid;
						return (
							<button
								key={o.uid}
								type="button"
								role="radio"
								aria-checked={selected}
								onClick={() => onWho(o.uid)}
								className={cx(
									"state-layer flex min-h-14 w-full items-center gap-3 rounded-shape-md border px-3 text-left text-body-large",
									selected ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline text-on-surface",
								)}
							>
								<Avatar name={o.isYou ? "Eu" : o.name} src={o.picture} size="sm" managed={!o.isYou} />
								<span className="min-w-0 flex-1 break-words font-medium">{o.isYou ? "Eu" : <>{o.name} <span className="font-normal">(você cuida)</span></>}</span>
								<span
									aria-hidden="true"
									className={cx("flex size-6 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-on-secondary-container" : "border-outline")}
								>
									{selected && <span className="size-3 rounded-full bg-on-secondary-container" />}
								</span>
							</button>
						);
					})}
				</div>
			)}

			<div className="space-y-2">
				<p className="text-title-large">
					{forOther ? `Ao ajudar, ${chosen.name} entra na divisão` : "Ao ajudar, você entra na divisão"}
					{share !== null && (
						<>
							{" "}e {forOther ? "a parte fica em" : "sua parte fica em"} <span className="money whitespace-nowrap font-bold">{formatBRL(share)}</span>
						</>
					)}
					.
				</p>
				<ul className="space-y-1 text-body-large text-on-surface-variant">
					<li className="flex gap-2">
						<Icon name="check" size={20} className="mt-0.5 text-primary" />
						A parte de cada um diminui.
					</li>
					<li className="flex gap-2">
						<Icon name="check" size={20} className="mt-0.5 text-primary" />
						{forOther ? `A parte de ${chosen.name} vai para ${payer}` : `Você paga a sua parte para ${payer}`}, por Pix ou em dinheiro.
					</li>
				</ul>
			</div>

			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button icon={busy ? undefined : "favorite"} onClick={onConfirm} loading={busy} disabled={busy} fullWidth>
					{busy ? "Entrando..." : "Sim, quero ajudar"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Agora não
				</Button>
			</div>
		</div>
	);
}
