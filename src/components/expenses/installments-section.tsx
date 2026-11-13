"use client";

import { useState } from "react";
import { Button, List, ListItem, StatusChip } from "@/components/ui";
import { formatDateShort } from "@/lib/ui/dates";
import { seriesItemChipText, seriesItemState, type SeriesItemState } from "@/lib/ui/due-dates";
import type { ExpenseSeries } from "./types";

const CHIP_TONE: Record<SeriesItemState, "ok" | "owe" | "wait"> = { paid: "ok", overdue: "owe", partial: "wait", open: "wait" };

/** Acima disto a lista começa resumida: a parcela atual e as vizinhas. */
const COLLAPSE_ABOVE = 8;

/** "Parcelas": a série inteira, cada uma levando à sua página; a atual fica destacada. */
export function InstallmentsSection({
	groupId,
	currentId,
	series,
	today,
}: Readonly<{ groupId: string; currentId: string; series: ExpenseSeries; today: string }>) {
	const [expanded, setExpanded] = useState(false);
	const items = series.items;
	const currentIndex = Math.max(0, items.findIndex((i) => i.id === currentId));
	const collapsed = items.length > COLLAPSE_ABOVE && !expanded;
	const visible = collapsed ? items.slice(Math.max(0, currentIndex - 2), currentIndex + 3) : items;
	const hidden = items.length - visible.length;
	return (
		<section className="space-y-3" aria-labelledby="parcelas-titulo">
			<h2 id="parcelas-titulo" className="text-title-large">
				Parcelas
			</h2>
			<List>
				{visible.map((i) => {
					const state = seriesItemState(i, today);
					const current = i.id === currentId;
					return (
						<ListItem
							key={i.id}
							href={`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(i.id)}`}
							className={current ? "bg-secondary-container" : undefined}
							leading={
								<span
									aria-hidden="true"
									className={`flex size-10 shrink-0 items-center justify-center rounded-full text-title-medium ${
										current ? "bg-primary text-on-primary" : "bg-secondary-container text-on-secondary-container"
									}`}
								>
									{i.number}
								</span>
							}
							headline={`Parcela ${i.number}`}
							supporting={
								<span className="block text-on-surface-variant">
									{[i.dueDate ? formatDateShort(i.dueDate, today) : "", current ? "esta parcela" : ""].filter(Boolean).join(" · ")}
								</span>
							}
							trailing={<StatusChip tone={CHIP_TONE[state]}>{seriesItemChipText(i, state)}</StatusChip>}
						/>
					);
				})}
			</List>
			{items.length > COLLAPSE_ABOVE && (
				<Button variant="text" size="md" icon={expanded ? "expand_less" : "expand_more"} onClick={() => setExpanded((x) => !x)} className="-ml-4">
					{expanded ? "Mostrar menos parcelas" : `Ver todas as ${items.length} parcelas`}
				</Button>
			)}
			{collapsed && hidden > 0 && <p className="sr-only">Mostrando {visible.length} de {items.length} parcelas.</p>}
		</section>
	);
}
