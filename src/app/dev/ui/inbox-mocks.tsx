"use client";

import { useState } from "react";
import { InboxView } from "@/components/inbox/inbox-view";
import type { InboxItem } from "@/lib/ui/inbox";
import { MockHome, Shell as MockShell } from "./expense-mocks";

// Instante fixo (nunca new Date() no módulo: o servidor e o navegador calculariam horas diferentes).
const NOW = new Date("2026-11-13T17:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const ITEMS: InboxItem[] = [
	{ id: "1", title: "Maria pagou sua parte", body: 'Maria pagou R$ 47,00 em "Mercado do mês" (Despesas da família).', url: "/app/grupos/1/despesas/e1", createdAt: ago(4), read: false },
	{ id: "2", title: "Nova despesa", body: 'Carlos lançou "Pizza de sábado" (Amigos da faculdade). Sua parte: R$ 38,50.', url: "/app/grupos/2/despesas/e2", createdAt: ago(95), read: false },
	{ id: "3", title: "Lembrete: Aluguel vence amanhã", body: 'Você ainda deve R$ 850,00 em "Aluguel" (Casa da praia).', url: "/app/grupos/3/despesas/e3", createdAt: ago(60 * 24 - 120), read: true },
	{ id: "4", title: "Plano confirmado", body: 'O plano "Fim de semana em Paraty" virou o grupo "Paraty".', url: "/app/grupos/4", createdAt: ago(60 * 24 * 3), read: true },
	{ id: "5", title: "Ana entrou no grupo", body: 'Ana entrou em "Despesas da família".', url: "/app/grupos/1", createdAt: ago(60 * 24 * 12), read: true },
];

export type InboxScene = "topo" | "nao-lidos" | "lidos" | "vazio" | "carregando" | "erro";

/** Página de avisos e topo com o sininho, com dados de mentira (só desenvolvimento). */
export function MockInbox({ scene, unseen = 0, framed = false }: Readonly<{ scene: InboxScene; unseen?: number; framed?: boolean }>) {
	const [items, setItems] = useState(scene === "lidos" ? ITEMS.map((i) => ({ ...i, read: true })) : scene === "vazio" ? [] : ITEMS);
	if (scene === "topo") return <MockHome framed={framed} unseen={unseen} />;
	return (
		<MockShell pathname="/app/avisos" framed={framed}>
			<InboxView
				status={scene === "carregando" ? "loading" : scene === "erro" ? "error" : "ready"}
				items={items}
				now={NOW}
				onRetry={() => {}}
				onOpen={(it) => setItems((cur) => cur.map((i) => (i.id === it.id ? { ...i, read: true } : i)))}
				onMarkAllRead={() => setItems((cur) => cur.map((i) => ({ ...i, read: true })))}
			/>
		</MockShell>
	);
}
