"use client";

import { useState } from "react";
import { Avatar, FilterChip, SegmentedButton } from "@/components/ui";
import { peopleLabel } from "@/lib/ui/invite";

export type SplitMode = "all" | "choose" | "alone";
export type SplitMember = { uid: string; name: string; picture: string | null; isYou: boolean; kind?: "user" | "managed" };

export const ALONE_HINT = "Você pode incluir as outras pessoas depois, quando entrarem no grupo.";

export const ALONE_EXPLANATION = "A despesa fica registrada e ninguém fica devendo. Quem quiser pode tocar em 'Quero ajudar' depois.";

const OPTIONS = [
	{ value: "all", label: "Todos" },
	{ value: "choose", label: "Escolher pessoas" },
] as const;
const OPTIONS_WITH_ALONE = [...OPTIONS, { value: "alone", label: "Só eu" }] as const;

/** "Todos" se a seleção é o grupo inteiro (com mais de uma pessoa); senão "Escolher pessoas". */
export function modeFor(selected: string[], memberUids: string[]): SplitMode {
	return memberUids.length > 0 && selected.length === memberUids.length && memberUids.every((u) => selected.includes(u)) ? "all" : "choose";
}

/** Estado de "quem divide": o modo e as pessoas marcadas. Em "Todos", a seleção é sempre o grupo inteiro. */
export function useWhoSplits(memberUids: string[], initial?: string[], aloneUid?: string) {
	const [selected, setSelected] = useState<string[]>(initial ?? memberUids);
	const [mode, setModeState] = useState<SplitMode>(modeFor(initial ?? memberUids, memberUids));
	return {
		selected,
		mode,
		setMode(m: SplitMode) {
			setModeState(m);
			if (m === "all") setSelected(memberUids);
			if (m === "alone" && aloneUid) setSelected([aloneUid]);
		},
		toggle(uid: string) {
			setSelected((cur) => (cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid]));
		},
	};
}

/** Escolha "Todos" ou "Escolher pessoas"; em "Escolher pessoas" aparece a lista de quem divide. */
export function WhoSplits({
	members,
	selected,
	mode,
	onMode,
	onToggle,
	error,
	showAloneHint = true,
	allowAlone = false,
	payerUid,
}: Readonly<{
	members: SplitMember[];
	selected: string[];
	mode: SplitMode;
	onMode: (m: SplitMode) => void;
	onToggle: (uid: string) => void;
	error?: string;
	showAloneHint?: boolean;
	/** Terceira opção "Só eu": a despesa fica só com quem pagou (para "Quero ajudar" depois). */
	allowAlone?: boolean;
	/** Quem pagou (padrão: você). */
	payerUid?: string;
}>) {
	const me = members.find((m) => m.isYou);
	const only = payerUid ?? me?.uid;
	const onlyMe = members.length > 0 && selected.length === 1 && selected[0] === only;
	return (
		<div className="space-y-3">
			<SegmentedButton label="Quem divide" value={mode} options={allowAlone ? OPTIONS_WITH_ALONE : OPTIONS} onChange={onMode} />

			{mode === "alone" ? null : mode === "all" ? (
				<p className="text-body-large text-on-surface-variant">
					{members.length <= 1 ? "Só você, por enquanto" : `Todas as ${members.length} pessoas do grupo`}
				</p>
			) : (
				<div className="space-y-2">
					<p className="text-body-large text-on-surface-variant">
						{selected.length === 0 ? "Marque quem vai dividir" : peopleLabel(selected.length) + (selected.length === 1 ? " marcada" : " marcadas")}
					</p>
					<div className="flex flex-wrap gap-2">
						{members.map((m) => (
							<FilterChip
								key={m.uid}
								selected={selected.includes(m.uid)}
								onToggle={() => onToggle(m.uid)}
								leading={<Avatar name={m.name} src={m.picture} size="sm" className="size-10" managed={m.kind === "managed"} />}
								className="max-w-full sm:max-w-xs"
							>
								{m.isYou ? "Você" : m.kind === "managed" ? `${m.name} · sem celular` : m.name}
							</FilterChip>
						))}
					</div>
				</div>
			)}

			{allowAlone && onlyMe ? (
				<p className="text-body-large text-on-surface-variant">{ALONE_EXPLANATION}</p>
			) : (
				showAloneHint && onlyMe && <p className="text-body-large text-on-surface-variant">{ALONE_HINT}</p>
			)}
			{error && (
				<p role="alert" className="text-body-large text-error">
					{error}
				</p>
			)}
		</div>
	);
}
