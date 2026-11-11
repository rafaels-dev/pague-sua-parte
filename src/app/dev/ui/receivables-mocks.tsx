"use client";

import { useState } from "react";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { collectIntro, collectShareText } from "@/components/receivables/receivables-page";
import { ReceivablesView, type ReceivablesPageState } from "@/components/receivables/receivables-view";
import { Sheet } from "@/components/ui";
import { todayISO } from "@/lib/ui/dates";
import { nextDayOfMonth } from "@/lib/ui/due-dates";
import type { Debtor, ReceivableItem, Receivables } from "@/lib/ui/receivables";
import { Shell } from "./expense-mocks";

const noop = () => {};
const TODAY = todayISO();
const daysAgo = (n: number) => {
	const d = new Date(`${TODAY}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
};
const THIS_MONTH_END = `${TODAY.slice(0, 8)}28`;

const item = (o: Partial<ReceivableItem> & Pick<ReceivableItem, "expenseId" | "description" | "dueCents">): ReceivableItem => ({
	groupId: "1",
	groupName: "Despesas da vó",
	dueDate: null,
	overdue: false,
	installment: null,
	recurrence: false,
	payeeIsYou: true,
	payeeName: "Rafael Schettino",
	...o,
});

const debtor = (d: Omit<Debtor, "totalCents" | "overdueCents" | "youManage" | "picture" | "managedByName" | "kind"> & Partial<Debtor>): Debtor => ({
	picture: null,
	kind: "user",
	managedByName: null,
	youManage: false,
	totalCents: d.items.reduce((s, i) => s + i.dueCents, 0),
	overdueCents: d.items.filter((i) => i.overdue).reduce((s, i) => s + i.dueCents, 0),
	...d,
});

export const DEBTORS: Debtor[] = [
	debtor({
		uid: "b",
		name: "Maria das Dores Silva",
		items: [
			item({ expenseId: "e2", description: "Mercado do mês", dueCents: 10000, dueDate: daysAgo(6), overdue: true }),
			item({ expenseId: "e3", description: "Geladeira nova", dueCents: 12000, dueDate: nextDayOfMonth(TODAY, 28) || THIS_MONTH_END, installment: { number: 2, count: 6 } }),
			item({ expenseId: "e4", description: "Fraldas geriátricas", dueCents: 3333, payeeIsYou: false, payeeName: "Benjamim" }),
			item({ expenseId: "e5", description: "Aluguel da casa da vó", dueCents: 40000, groupId: "2", groupName: "Casa da praia", recurrence: true, dueDate: nextDayOfMonth(TODAY, 5) }),
			item({ expenseId: "e1", description: "Remédios da farmácia", dueCents: 7248 }),
		],
	}),
	debtor({
		uid: "m2",
		name: "Tio Carlos",
		kind: "managed",
		managedByName: "Renata Lima",
		items: [item({ expenseId: "e6", description: "Cuidadora de sábado", dueCents: 8000 }), item({ expenseId: "e7", description: "Passagem de ônibus", dueCents: 2500 })],
	}),
	debtor({ uid: "c", name: "José Pereira", items: [item({ expenseId: "e8", description: "Presente da mãe", dueCents: 4500, groupName: "Natal", groupId: "3" })] }),
];

const dataOf = (debtors: Debtor[]): Receivables => ({
	debtors,
	totalCents: debtors.reduce((s, d) => s + d.totalCents, 0),
	nowCents: debtors.reduce((s, d) => s + d.items.filter((i) => !i.dueDate || i.dueDate <= `${TODAY.slice(0, 8)}31`).reduce((t, i) => t + i.dueCents, 0), 0),
	managedCents: debtors.reduce((s, d) => s + d.items.filter((i) => !i.payeeIsYou).reduce((t, i) => t + i.dueCents, 0), 0),
	truncated: false,
});

export type ReceivablesScene = "lista" | "whatsapp" | "whatsapp-cuidado" | "vazio" | "carregando" | "erro" | "indisponivel";

const sceneState = (scene: ReceivablesScene): ReceivablesPageState => {
	switch (scene) {
		case "carregando":
			return { kind: "loading" };
		case "erro":
			return { kind: "error", message: "Sem conexão. Verifique sua internet e tente de novo." };
		case "indisponivel":
			return { kind: "unavailable" };
		case "vazio":
			return { kind: "ready", data: dataOf([]) };
		default:
			return { kind: "ready", data: dataOf(DEBTORS) };
	}
};

/** "Quem me deve" com dados de mentira; `whatsapp` abre o sheet de cobrança. */
export function MockReceivables({ scene = "lista", framed = true }: Readonly<{ scene?: ReceivablesScene; framed?: boolean }>) {
	const [shareFor, setShareFor] = useState<string | null>(scene === "whatsapp" ? "b" : scene === "whatsapp-cuidado" ? "m2" : null);
	const state = sceneState(scene);
	const debtorToShare = state.kind === "ready" ? state.data.debtors.find((d) => d.uid === shareFor) : undefined;
	return (
		<Shell pathname="/app/receber" framed={framed}>
			<ReceivablesView state={state} onCollect={setShareFor} onRetry={noop} />
			<Sheet open={!!debtorToShare} onClose={() => setShareFor(null)} title="Cobrar no WhatsApp">
				{debtorToShare && (
					<ShareExpenseContent
						text={collectShareText(debtorToShare, "https://pague-sua-parte.app")}
						intro={collectIntro(debtorToShare)}
						whatsappLabel="Cobrar no WhatsApp"
						canShare
						copyFailed={false}
						onCopy={noop}
						onShare={noop}
						onClose={() => setShareFor(null)}
					/>
				)}
			</Sheet>
		</Shell>
	);
}
