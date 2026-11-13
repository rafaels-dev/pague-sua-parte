"use client";

import { useState } from "react";
import { AppShellView } from "@/components/app-shell";
import { AttachmentPicker } from "@/components/expenses/attachment-picker";
import { ReceiptSheetContent } from "@/components/expenses/receipt-sheet";
import type { ReceiptMode } from "@/lib/ui/receipts";
import type { PickedFile } from "@/components/expenses/use-attachments";
import { ExpenseDetailView, SharePaidContent, sharePaidTitle } from "@/components/expenses/expense-detail";
import { buildExpenseStatusText, expenseSummaryIntro } from "@/lib/ui/expense-summary";
import { buildGroupSummaryText, type GroupSummaryData } from "@/lib/ui/group-summary";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { ResplitContent } from "@/components/expenses/resplit-sheet";
import { useWhoSplits } from "@/components/expenses/who-splits";
import { ChooseGroupSheet, GroupsListView, type GroupSummary } from "@/components/groups/groups-list";
import type { MeSummary } from "@/lib/ui/managed";
import { GroupSummaryView, HomeSummary } from "@/components/home-summary";
import { expenseShareLink, groupShareLink } from "@/lib/ui/share-link";
import { buildExpenseShareText, shareIntro } from "@/lib/ui/expense-share";
import type { AttachmentView } from "@/components/expenses/expense-attachments";
import { HelpContent, helperOptions } from "@/components/expenses/help";
import { ExpenseListView } from "@/components/expenses/expense-list";
import { NewExpenseFormView, NoPixKeyBlock, type FormErrors } from "@/components/expenses/new-expense-form";
import type { ExpenseDetailData, ExpenseShare, ExpenseSummary } from "@/components/expenses/types";
import { useAttachments } from "@/components/expenses/use-attachments";
import { AddManagedButton, GroupDetailView, type Group } from "@/components/groups/group-detail";
import { carersOf, ChangeCarerContent, ManagedFormContent, ManagedOptionsContent } from "@/components/groups/managed-sheet";
import { normalizeMember, type Member } from "@/components/groups/types";
import { ManagedSummaryCards } from "@/components/home-summary";
import { ReportView, type ReportState } from "@/components/reports/group-report";
import type { ReportData } from "@/lib/ui/report";
import { Button, Sheet } from "@/components/ui";
import {
	RecurrenceEditContent,
	RecurrenceEndContent,
	RecurrenceOptionsContent,
	RecurrencesDetails,
} from "@/components/recurrences/recurrence-list";
import type { Recurrence } from "@/components/recurrences/types";
import { todayISO } from "@/lib/ui/dates";
import { addMonthsClamped, nextDayOfMonth } from "@/lib/ui/due-dates";
import type { PaymentKind } from "@/components/expenses/payment-choice";
import type { ExpenseSeries } from "@/components/expenses/types";
import type { InstallmentScope } from "@/components/expenses/installment-scope";
import { DeleteInstallmentContent, ResplitScopeContent } from "@/components/expenses/installment-scope";
import { normalizeGroup } from "@/components/groups/groups-list";

const noop = () => {};
const USER = { name: "Rafael Schettino", email: "rafael@example.com", picture: null };

type MemberInit = Partial<Member> & Pick<Member, "uid" | "name">;
const member = (m: MemberInit): Member => normalizeMember({ picture: null, role: "member", hasPixKey: true, isYou: false, ...m });

export const MOCK_GROUP: Group = {
	id: "1",
	name: "Despesas da vó",
	role: "admin",
	members: [
		member({ uid: "a", name: "Rafael Schettino", role: "admin", isYou: true }),
		member({ uid: "b", name: "Maria das Dores Silva" }),
		member({ uid: "c", name: "José" }),
		member({ uid: "d", name: "Ana Paula", hasPixKey: false }),
	],
};

/** Cenário "pessoa sem celular": quem usa o app é a Renata, que cuida do avô Benjamim (e do tio Carlos, ainda sem chave Pix). */
const KEY_BENJAMIM = { type: "cpf" as const, key: "52998224725" };
export const CARE_GROUP: Group = {
	id: "1",
	name: "Despesas da família",
	role: "admin",
	members: [
		member({ uid: "a", name: "Renata Souza", role: "admin", isYou: true }),
		member({ uid: "b", name: "Maria das Dores Silva" }),
		member({ uid: "c", name: "José" }),
		member({ uid: "m1", name: "Benjamim", kind: "managed", managedBy: { uid: "a", name: "Renata Souza", isYou: true }, youManage: true, canEdit: true, pixKey: KEY_BENJAMIM }),
		member({ uid: "m2", name: "Dona Lourdes", kind: "managed", managedBy: { uid: "b", name: "Maria das Dores Silva", isYou: false }, hasPixKey: false, canEdit: true }),
		member({ uid: "m3", name: "Tio Carlos", kind: "managed", managedBy: { uid: "a", name: "Renata Souza", isYou: true }, youManage: true, hasPixKey: false, canEdit: true }),
	],
};
const CARE_USER = { name: "Renata Souza", email: "renata@example.com", picture: null };

const TODAY = todayISO();
const daysAgo = (n: number) => {
	const d = new Date(`${TODAY}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
};
type SumInput = Omit<ExpenseSummary, "canHelp" | "ownerAlone" | "helpShareCents" | "yourDueCents" | "yourRefundCents" | "refundCount" | "managed" | "ownerView" | "paidBy" | "dueDate" | "installment" | "recurrence" | "overdue" | "settled" | "attachmentCount"> &
	Partial<Pick<ExpenseSummary, "canHelp" | "ownerAlone" | "helpShareCents" | "attachmentCount" | "yourDueCents" | "yourRefundCents" | "refundCount" | "managed" | "ownerView" | "dueDate" | "installment" | "recurrence" | "overdue" | "settled">> & {
		paidBy: { uid: string; name: string; isYou: boolean; youManage?: boolean };
	};
const sum = (o: SumInput): ExpenseSummary => ({
	yourDueCents: o.yourStatus === "pending" ? o.yourShareCents : 0,
	yourRefundCents: 0,
	refundCount: 0,
	managed: [],
	ownerView: null,
	attachmentCount: 0,
	canHelp: false,
	ownerAlone: false,
	helpShareCents: null,
	dueDate: null,
	installment: null,
	recurrence: null,
	overdue: false,
	settled: o.pendingCount === 0 && (o.refundCount ?? 0) === 0 && o.yourStatus !== "pending" && o.yourStatus !== "refund",
	...o,
	paidBy: { ...o.paidBy, youManage: o.paidBy.youManage ?? false },
});

/** Despesa do mês criada por uma despesa fixa (mostra o selo "Todo mês"). */
const MONTHLY_EXPENSE = sum({
	id: "r1-m",
	description: "Aluguel da casa da vó",
	amountCents: 120000,
	date: TODAY.slice(0, 7) + "-10",
	paidBy: { uid: "b", name: "Maria das Dores Silva", isYou: false },
	yourShareCents: 30000,
	yourStatus: "pending",
	pendingCount: 3,
	dueDate: TODAY.slice(0, 7) + "-10",
	recurrence: { id: "r1", period: TODAY.slice(0, 7) },
});

const EXPENSES: ExpenseSummary[] = [
	sum({ id: "e1", description: "Remédios da farmácia", amountCents: 28990, date: daysAgo(0), paidBy: { uid: "b", name: "Maria das Dores Silva", isYou: false }, yourShareCents: 7248, yourStatus: "pending", pendingCount: 3, attachmentCount: 2 }),
	sum({ id: "e2", description: "Consulta com a cardiologista", amountCents: 45000, date: daysAgo(1), paidBy: { uid: "a", name: "Rafael Schettino", isYou: true }, yourShareCents: 11250, yourStatus: "payer", pendingCount: 2, refundCount: 1, attachmentCount: 1 }),
	sum({ id: "e6", description: "Ração e areia da gata", amountCents: 18000, date: daysAgo(2), paidBy: { uid: "b", name: "Maria das Dores Silva", isYou: false }, yourShareCents: 4500, yourStatus: "refund", yourRefundCents: 1500, pendingCount: 1, attachmentCount: 0 }),
	sum({ id: "e7", description: "Mercado do mês", amountCents: 62000, date: daysAgo(3), paidBy: { uid: "c", name: "José", isYou: false }, yourShareCents: 15500, yourDueCents: 5500, yourStatus: "pending", pendingCount: 1, attachmentCount: 1 }),
	sum({ id: "e8", description: "Fisioterapia", amountCents: 24000, date: daysAgo(5), paidBy: { uid: "a", name: "Rafael Schettino", isYou: true }, yourShareCents: 24000, yourStatus: "payer", pendingCount: 0, refundCount: 2, attachmentCount: 0 }),
	sum({ id: "e3", description: "Fraldas geriátricas", amountCents: 12000, date: daysAgo(9), paidBy: { uid: "c", name: "José", isYou: false }, yourShareCents: 3000, yourStatus: "paid", pendingCount: 1, attachmentCount: 0 }),
	sum({ id: "e4", description: "Exame de sangue e raio-x do tornozelo na clínica", amountCents: 31050, date: daysAgo(40), paidBy: { uid: "a", name: "Rafael Schettino", isYou: true }, yourShareCents: 7762, yourStatus: "payer", pendingCount: 0, attachmentCount: 3 }),
	sum({ id: "e5", description: "Cuidadora de sábado", amountCents: 20000, date: "2025-06-14", paidBy: { uid: "d", name: "Ana Paula", isYou: false }, yourShareCents: 0, yourStatus: "none", pendingCount: 2, attachmentCount: 0 }),
];

export function Shell({ pathname, search, children, framed, user = USER }: Readonly<{ pathname: string; search?: string; children: React.ReactNode; framed: boolean; user?: typeof USER }>) {
	return (
		<AppShellView pathname={pathname} search={search} user={user} onSignOut={noop} className={framed ? "min-h-0!" : undefined}>
			{children}
		</AppShellView>
	);
}

const CARE_EXPENSES: ExpenseSummary[] = [
	sum({
		id: "c1",
		description: "Remédios do Benjamim",
		amountCents: 28990,
		date: daysAgo(0),
		paidBy: { uid: "m1", name: "Benjamim", isYou: false, youManage: true },
		yourShareCents: 7248,
		yourStatus: "pending",
		pendingCount: 2,
		attachmentCount: 1,
		ownerView: { pendingCount: 2, refundCount: 0 },
		managed: [],
	}),
	sum({
		id: "c2",
		description: "Mercado do mês",
		amountCents: 62000,
		date: daysAgo(2),
		paidBy: { uid: "b", name: "Maria das Dores Silva", isYou: false },
		yourShareCents: 10333,
		yourDueCents: 10333,
		yourStatus: "pending",
		pendingCount: 3,
		attachmentCount: 0,
		managed: [{ uid: "m1", name: "Benjamim", status: "pending", dueCents: 10333, refundCents: 0 }],
	}),
	sum({
		id: "c3",
		description: "Ração e areia da gata",
		amountCents: 18000,
		date: daysAgo(4),
		paidBy: { uid: "c", name: "José", isYou: false },
		yourShareCents: 3000,
		yourStatus: "paid",
		pendingCount: 1,
		attachmentCount: 0,
		managed: [{ uid: "m1", name: "Benjamim", status: "refund", dueCents: 0, refundCents: 1500 }],
	}),
	sum({ id: "c4", description: "Consulta com a cardiologista", amountCents: 45000, date: daysAgo(8), paidBy: { uid: "a", name: "Renata Souza", isYou: true }, yourShareCents: 11250, yourStatus: "payer", pendingCount: 0, attachmentCount: 1 }),
];

/** Dia do vencimento mais próximo: o dia 10 que vem (ou hoje, se hoje é dia 10). */
const DUE_NEXT = nextDayOfMonth(TODAY, 10);
const ME = { uid: "a", name: "Rafael Schettino", isYou: true };
const MARIA = { uid: "b", name: "Maria das Dores Silva", isYou: false };

/** Grupo com vencimentos: vencida, no cartão, parcelada, comum, e muitas quitadas (a lista de quitadas começa recolhida). */
const DUE_EXPENSES: ExpenseSummary[] = [
	sum({ id: "v1", description: "Geladeira nova", amountCents: 12000, date: daysAgo(40), paidBy: MARIA, yourShareCents: 3000, yourStatus: "pending", pendingCount: 3, dueDate: daysAgo(8), overdue: true, installment: { seriesId: "s1", number: 2, count: 4 } }),
	sum({ id: "v2", description: "Notebook da escola", amountCents: 45000, date: daysAgo(3), paidBy: ME, yourShareCents: 11250, yourStatus: "payer", pendingCount: 3, dueDate: DUE_NEXT, installment: { seriesId: "s2", number: 1, count: 6 } }),
	sum({ id: "v3", description: "Passagem de ônibus", amountCents: 9000, date: daysAgo(1), paidBy: MARIA, yourShareCents: 2250, yourStatus: "pending", pendingCount: 2, dueDate: addMonthsClamped(DUE_NEXT, 1) }),
	sum({ id: "v4", description: "Remédios da farmácia", amountCents: 28990, date: daysAgo(0), paidBy: MARIA, yourShareCents: 7248, yourStatus: "pending", pendingCount: 3, attachmentCount: 2 }),
	...["Mercado do mês", "Consulta", "Fraldas", "Gás", "Luz", "Água", "Internet"].map((d, i) =>
		sum({ id: `q${i}`, description: d, amountCents: 8000 + i * 1500, date: daysAgo(30 + i * 9), paidBy: i % 2 ? MARIA : ME, yourShareCents: 2000, yourStatus: i % 2 ? "paid" : "payer", pendingCount: 0 }),
	),
];

/** Despesas em que o Rafael pode ajudar: duas em que quem pagou está sozinho. */
const HELP_EXPENSES: ExpenseSummary[] = EXPENSES.map((e) =>
	e.id === "e1"
		? { ...e, yourStatus: "none", yourShareCents: 0, yourDueCents: 0, canHelp: true, ownerAlone: true, helpShareCents: 14495, pendingCount: 0 }
		: e.id === "e7"
			? { ...e, yourStatus: "none", yourShareCents: 0, yourDueCents: 0, canHelp: true, ownerAlone: true, helpShareCents: 31000, pendingCount: 0 }
			: e,
);

/** Resumo de um grupo: algo a pagar e a receber, mais Benjamim (que a Renata cuida) com a parte dele. */
const GROUP_SUMMARY: MeSummary = {
	toReceiveCents: 34500,
	toPayCents: 21000,
	toReceiveNowCents: 12000,
	toPayNowCents: 9000,
	overdueToPayCents: 3000,
	managed: [
		{ uid: "m1", name: "Benjamim", groupId: "1", groupName: "Despesas da família", toReceiveCents: 14500, toPayCents: 10333, toReceiveNowCents: 14500, toPayNowCents: 10333, overdueToPayCents: 0 },
		{ uid: "m3", name: "Tio Carlos", groupId: "1", groupName: "Despesas da família", toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 },
	],
};
const GROUP_SUMMARY_SETTLED: MeSummary = {
	toReceiveCents: 0,
	toPayCents: 0,
	toReceiveNowCents: 0,
	toPayNowCents: 0,
	overdueToPayCents: 0,
	managed: GROUP_SUMMARY.managed.map((m) => ({ ...m, toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0 })),
};

const GROUP_SUMMARY_TEXT: GroupSummaryData = {
	groupName: "Despesas da vó",
	totalOpenCents: 71000,
	overdueCents: 31000,
	debts: [
		{ fromName: "Rafael Schettino", toName: "Maria das Dores Silva", cents: 15500, overdue: true, refund: false },
		{ fromName: "José Pereira", toName: "Maria das Dores Silva", cents: 15500, overdue: true, refund: false },
		{ fromName: "José Pereira", toName: "Rafael Schettino", cents: 15000, overdue: false, refund: false },
		{ fromName: "Rafael Schettino", toName: "Ana Paula", cents: 10000, overdue: false, refund: false },
		{ fromName: "Maria das Dores Silva", toName: "Ana Paula", cents: 10000, overdue: false, refund: false },
		{ fromName: "Rafael Schettino", toName: "Ana Paula", cents: 5000, overdue: false, refund: true },
	],
	moreDebts: 0,
	upToDate: ["Benjamim"],
	moreUpToDate: 0,
	expenses: [
		{ id: "e1", description: "Mercado do mês", totalCents: 62000, paidByName: "Maria das Dores Silva", dueDate: daysAgo(7), overdue: true, owes: [{ name: "Rafael Schettino", cents: 15500 }, { name: "José Pereira", cents: 15500 }], moreOwes: 0, refunds: [], moreRefunds: 0 },
		{ id: "e2", description: "Consulta", totalCents: 45000, paidByName: "Rafael Schettino", dueDate: daysAgo(-5), overdue: false, owes: [{ name: "José Pereira", cents: 15000 }], moreOwes: 0, refunds: [{ name: "Ana Paula", cents: 5000 }], moreRefunds: 0 },
		{ id: "e3", description: "Notebook (parcela 2 de 6)", totalCents: 30000, paidByName: "Ana Paula", dueDate: daysAgo(-12), overdue: false, owes: [{ name: "Rafael Schettino", cents: 10000 }, { name: "Maria das Dores Silva", cents: 10000 }], moreOwes: 0, refunds: [], moreRefunds: 0 },
	],
	moreExpenses: 0,
	upcoming: [
		{ id: "e2", dueDate: daysAgo(-5), description: "Consulta", paidByName: "Rafael Schettino", owes: [{ name: "José Pereira", cents: 15000 }], moreOwes: 0 },
		{ id: "e3", dueDate: daysAgo(-12), description: "Notebook (parcela 2 de 6)", paidByName: "Ana Paula", owes: [{ name: "Rafael Schettino", cents: 10000 }, { name: "Maria das Dores Silva", cents: 10000 }], moreOwes: 0 },
	],
	moreUpcoming: 0,
	upcomingTotalCents: 35000,
};

export function MockGroup({
	empty = false,
	framed = true,
	care = false,
	due = false,
	help = false,
	fixed,
	summary,
	summarySheet = false,
}: Readonly<{
	/** Abre o sheet "Compartilhar resumo" do grupo. */
	summarySheet?: boolean;
	empty?: boolean;
	framed?: boolean;
	care?: boolean;
	due?: boolean;
	help?: boolean;
	fixed?: "closed" | "open";
	/** Resumo do grupo no topo: com valores, tudo certo ("settled") ou carregando. */
	summary?: "valores" | "em-dia" | "carregando";
}>) {
	const group = care ? CARE_GROUP : MOCK_GROUP;
	const [summaryOpen, setSummaryOpen] = useState(summarySheet);
	return (
		<Shell pathname="/app/grupos/1" framed={framed} user={care ? CARE_USER : USER}>
			<Sheet open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Compartilhar resumo">
				<ShareExpenseContent
					text={buildGroupSummaryText(GROUP_SUMMARY_TEXT, groupShareLink("https://pague-sua-parte.app", "abc123", "1"))}
					intro="Mande o resumo para o grupo ver quem deve a quem. É o mesmo para todo mundo."
					canShare
					copyFailed={false}
					dismissLabel="Fechar"
					whatsappLabel="Compartilhar no WhatsApp"
					preview
					onCopy={noop}
					onShare={noop}
					onClose={() => setSummaryOpen(false)}
				/>
			</Sheet>
			<GroupDetailView
				onShareSummary={() => setSummaryOpen(true)}
				group={group}
				onMemberOptions={noop}
				summary={summary ? <GroupSummaryView groupId={group.id} loading={summary === "carregando"} summary={summary === "em-dia" ? GROUP_SUMMARY_SETTLED : GROUP_SUMMARY} /> : undefined}
				invite={
					<Button icon="share" fullWidth className="md:w-auto">
						Convidar pessoas
					</Button>
				}
				addManaged={care ? <AddManagedButton onClick={noop} /> : undefined}
				recurrences={fixed ? <RecurrencesDetails state={{ kind: "ready", items: MOCK_RECURRENCES }} today={TODAY} defaultOpen={fixed === "open"} /> : undefined}
				expenses={<ExpenseListView groupId="1" state={{ kind: "ready", expenses: empty ? [] : fixed ? [MONTHLY_EXPENSE, ...EXPENSES] : care ? CARE_EXPENSES : due ? DUE_EXPENSES : help ? HELP_EXPENSES : EXPENSES }} />}
			/>
		</Shell>
	);
}

const nextMonth = (day: number) => addMonthsClamped(nextDayOfMonth(TODAY, 1).slice(0, 8) + "01", 1).slice(0, 8) + String(day).padStart(2, "0");

/** Duas despesas fixas: o aluguel (sem fim, paga a Maria) e a cuidadora (até março, paga você). */
export const MOCK_RECURRENCES: Recurrence[] = [
	{
		id: "r1",
		description: "Aluguel da casa da vó",
		amountCents: 120000,
		dayOfMonth: 25,
		participantMode: "all",
		participantUids: ["a", "b", "c", "d"],
		paidBy: { uid: "b", name: "Maria das Dores Silva", picture: null, isYou: false, kind: "user", youManage: false },
		startPeriod: TODAY.slice(0, 7),
		endPeriod: null,
		nextDueDate: nextDayOfMonth(TODAY, 25),
		canEdit: true,
	},
	{
		id: "r2",
		description: "Cuidadora de sábado",
		amountCents: 32000,
		dayOfMonth: 5,
		participantMode: "selected",
		participantUids: ["a", "b"],
		paidBy: { uid: "a", name: "Rafael Schettino", picture: null, isYou: true, kind: "user", youManage: false },
		startPeriod: TODAY.slice(0, 7),
		endPeriod: `${Number(TODAY.slice(0, 4)) + 1}-03`,
		nextDueDate: nextMonth(5),
		canEdit: true,
	},
];

/** Tela do grupo com o sheet de uma despesa fixa: opções, mudar ou encerrar. */
export function MockRecurrenceSheet({ view = "edit", framed = true }: Readonly<{ view?: "options" | "edit" | "end"; framed?: boolean }>) {
	const [open, setOpen] = useState(true);
	const r = MOCK_RECURRENCES[0];
	const [description, setDescription] = useState(r.description);
	const [amount, setAmount] = useState(r.amountCents);
	const [day, setDay] = useState(r.dayOfMonth);
	const [end, setEnd] = useState<string | null>(null);
	const close = () => setOpen(false);
	const title = { options: r.description, edit: "Mudar despesa fixa", end: "Encerrar despesa fixa?" }[view];
	return (
		<Shell pathname="/app/grupos/1" framed={framed}>
			<GroupDetailView
				group={MOCK_GROUP}
				onMemberOptions={noop}
				invite={
					<Button icon="share" fullWidth className="md:w-auto">
						Convidar pessoas
					</Button>
				}
				recurrences={<RecurrencesDetails state={{ kind: "ready", items: MOCK_RECURRENCES }} today={TODAY} defaultOpen onOptions={() => setOpen(true)} />}
				expenses={<ExpenseListView groupId="1" state={{ kind: "ready", expenses: [MONTHLY_EXPENSE, ...EXPENSES] }} />}
			/>
			<Sheet open={open} onClose={close} title={title}>
				{view === "options" && <RecurrenceOptionsContent recurrence={r} onEdit={noop} onEnd={noop} />}
				{view === "edit" && (
					<RecurrenceEditContent
						description={description}
						amountCents={amount}
						dayOfMonth={day}
						endPeriod={end}
						errors={{}}
						busy={false}
						onDescription={setDescription}
						onAmount={setAmount}
						onDay={setDay}
						onEndPeriod={setEnd}
						onSubmit={close}
						onCancel={close}
					/>
				)}
				{view === "end" && <RecurrenceEndContent recurrence={r} busy={false} error={null} onConfirm={close} onCancel={close} />}
			</Sheet>
		</Shell>
	);
}

/** Tela do grupo com o sheet de adicionar pessoa sem celular (ou, com `view`, as opções / editar / trocar responsável). */
export function MockManagedSheet({
	framed = true,
	view = "add",
	filled = false,
	errors = {},
}: Readonly<{ framed?: boolean; view?: "add" | "options" | "edit" | "carer" | "remove"; filled?: boolean; errors?: React.ComponentProps<typeof ManagedFormContent>["errors"] }>) {
	const [open, setOpen] = useState(true);
	const [name, setName] = useState(filled ? "Benjamim Souza" : "");
	const [carer, setCarer] = useState("a");
	const [pix, setPix] = useState(filled ? "529.982.247-25" : "");
	const m1 = CARE_GROUP.members.find((m) => m.uid === "m1")!;
	const carers = carersOf(CARE_GROUP.members);
	const close = () => setOpen(false);
	const title = { add: "Adicionar pessoa sem celular", options: m1.name, edit: `Editar ${m1.name}`, carer: "Trocar responsável", remove: m1.name }[view];
	return (
		<Shell pathname="/app/grupos/1" framed={framed} user={CARE_USER}>
			<GroupDetailView
				group={CARE_GROUP}
				onMemberOptions={noop}
				invite={
					<Button icon="share" fullWidth className="md:w-auto">
						Convidar pessoas
					</Button>
				}
				addManaged={<AddManagedButton onClick={() => setOpen(true)} />}
				expenses={<ExpenseListView groupId="1" state={{ kind: "ready", expenses: CARE_EXPENSES }} />}
			/>
			<Sheet open={open} onClose={close} title={title}>
				{(view === "add" || view === "edit") && (
					<ManagedFormContent
						mode={view}
						name={view === "edit" ? name || m1.name : name}
						carerUid={carer}
						pixKey={view === "edit" && !pix ? m1.pixKey?.key ?? "" : pix}
						carers={view === "add" ? carers : []}
						errors={errors}
						busy={false}
						onName={setName}
						onCarer={setCarer}
						onPixKey={setPix}
						onSubmit={close}
						onCancel={close}
					/>
				)}
				{(view === "options" || view === "remove") && (
					<ManagedOptionsContent
						member={m1}
						isAdmin
						busy={false}
						error={null}
						confirmingRemove={view === "remove"}
						onEdit={noop}
						onChangeCarer={noop}
						onAskRemove={noop}
						onCancelRemove={close}
						onConfirmRemove={close}
					/>
				)}
				{view === "carer" && (
					<ChangeCarerContent name={m1.name} carers={carers} value={carer} busy={false} error={null} unchanged={carer === "a"} onChange={setCarer} onSubmit={close} onCancel={close} />
				)}
			</Sheet>
		</Shell>
	);
}

/** Tela "Lançar despesa" com estado local e os anexos de verdade (colar, arrastar e escolher funcionam aqui). */
export function MockNewExpense({
	framed = true,
	errors = {},
	initial,
	members = MOCK_GROUP.members,
	choose,
	alone = false,
	care = false,
	payer,
	pay,
	cashback,
	editing = false,
	admin = false,
}: Readonly<{
	/** Administrador lançando em nome de qualquer pessoa do grupo. */
	admin?: boolean;
	/** Tela "Editar despesa" (administrador editando a despesa de outra pessoa). */
	editing?: boolean;
	/** Começa em "Só eu". */
	alone?: boolean;
	/** Como foi pago ao abrir (à vista por padrão). */
	pay?: { payment: PaymentKind; dueDate?: string; installments?: number; dayOfMonth?: number; endPeriod?: string | null };
	/** Já abre com este cashback (e, no parcelado, esta escolha). */
	cashback?: { cents: number; mode?: "spread" | "first" };
	/** Cenário da Renata, que cuida de Benjamim e do tio Carlos. */
	care?: boolean;
	/** Quem pagou ao abrir (uid); sem isso, "Eu". */
	payer?: string;
	framed?: boolean;
	errors?: FormErrors;
	initial?: { amountCents: number; description: string };
	members?: Group["members"];
	/** Começa em "Escolher pessoas" com estas pessoas marcadas. */
	choose?: string[];
}>) {
	const [amountCents, setAmountCents] = useState(initial?.amountCents ?? 0);
	const [description, setDescription] = useState(initial?.description ?? "");
	const [date, setDate] = useState(TODAY);
	const [dateOpen, setDateOpen] = useState(false);
	const [payment, setPayment] = useState<PaymentKind>(pay?.payment ?? "cash");
	const [dueDate, setDueDate] = useState(pay?.dueDate ?? "");
	const [installments, setInstallments] = useState(pay?.installments ?? 6);
	const [dayOfMonth, setDayOfMonth] = useState(pay?.dayOfMonth ?? 10);
	const [endPeriod, setEndPeriod] = useState<string | null>(pay?.endPeriod ?? null);
	const [cashbackCents, setCashbackCents] = useState(cashback?.cents ?? 0);
	const [cashbackMode, setCashbackMode] = useState<"spread" | "first">(cashback?.mode ?? "spread");
	const list = care ? CARE_GROUP.members : members;
	const [payerUid, setPayerUid] = useState(payer ?? list.find((m) => m.isYou)?.uid ?? "");
	const who = useWhoSplits(list.map((m) => m.uid), undefined, payerUid);
	const [started, setStarted] = useState(false);
	if (!started && alone) {
		setStarted(true);
		who.setMode("alone");
	}
	if (!started && choose) {
		setStarted(true);
		who.setMode("choose");
		for (const uid of list.map((m) => m.uid)) if (!choose.includes(uid)) who.toggle(uid);
	}
	const att = useAttachments();
	return (
		<Shell pathname="/app/grupos/1/despesas/nova" framed={framed} user={care ? CARE_USER : USER}>
			<NewExpenseFormView
				editing={editing}
				isAdmin={admin}
				groupId="1"
				members={list}
				payerUid={payerUid}
				onPayer={setPayerUid}
				amountCents={amountCents}
				description={description}
				date={date}
				dateOpen={dateOpen}
				payment={payment}
				dueDate={dueDate}
				installments={installments}
				cashbackCents={cashbackCents}
				onCashback={setCashbackCents}
				cashbackMode={cashbackMode}
				onCashbackMode={setCashbackMode}
				dayOfMonth={dayOfMonth}
				endPeriod={endPeriod}
				onDayOfMonth={setDayOfMonth}
				onEndPeriod={setEndPeriod}
				onPayment={setPayment}
				onDueDate={setDueDate}
				onInstallments={setInstallments}
				selected={who.selected}
				splitMode={who.mode}
				onSplitMode={who.setMode}
				errors={errors}
				busy={false}
				onAmount={setAmountCents}
				onDescription={setDescription}
				onDate={setDate}
				onOpenDate={() => setDateOpen(true)}
				onToggle={who.toggle}
				onSubmit={noop}
				attachments={
					<AttachmentPicker
						items={att.items}
						problems={att.problems}
						processing={att.processing}
						dragging={att.dragging}
						canPaste={att.canReadClipboard}
						onPick={att.addFiles}
						onRemove={att.remove}
						onPaste={() => void att.pasteFromClipboard()}
					/>
				}
			/>
		</Shell>
	);
}

export function MockNoPixKey({ framed = true }: Readonly<{ framed?: boolean }>) {
	return (
		<Shell pathname="/app/grupos/1/despesas/nova" framed={framed}>
			<div className="mx-auto max-w-xl">
				<NoPixKeyBlock />
			</div>
		</Shell>
	);
}

const svgReceipt = (bg: string) =>
	`data:image/svg+xml;utf8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="${bg}"/><g fill="#555"><rect x="40" y="50" width="200" height="14"/><rect x="40" y="90" width="320" height="10"/><rect x="40" y="120" width="300" height="10"/><rect x="40" y="150" width="310" height="10"/><rect x="40" y="180" width="260" height="10"/><rect x="40" y="380" width="160" height="22"/></g></svg>`,
	)}`;

const ATTACHMENTS: AttachmentView[] = [
	{ id: "x1", name: "nota-farmacia.jpg", contentType: "image/jpeg", size: 380_000, url: svgReceipt("#f4efe2"), state: "ready" },
	{ id: "x2", name: "receita.png", contentType: "image/png", size: 210_000, url: svgReceipt("#e6eef7"), state: "ready" },
	{ id: "x3", name: "nota-da-consulta.pdf", contentType: "application/pdf", size: 1_200_000, url: null, state: "ready" },
];

type RawDetail = Omit<ExpenseDetailData, "canHelp" | "helpAsUids" | "helpShareCents" | "ownerAlone" | "canEdit" | "adminOnly" | "launchedBy">;
export type MockMode = "help-alone" | "help-split" | "helped" | "help-care" | "installment" | "overdue" | "owner-installment" | "monthly" | "cashback" | "cashback-installment" | "batch" | "debtor" | "payer" | "partial" | "refund" | "owner-return" | "recalc" | "two-parts" | "care-paid" | "self-owner" | "self-debtor" | "admin-view" | "admin-launched" | "refund-pay" | "refund-nopix" | "refund-done";
const isCare = (mode: MockMode) => mode === "two-parts" || mode === "care-paid" || mode === "help-care";

type MS = Partial<ExpenseShare> & Pick<ExpenseShare, "uid" | "name" | "amountCents" | "status">;
const share = (s: MS): ExpenseShare => ({
	markedByAdmin: false,
	markedByName: null,
	refund: null,
	canRefund: false,
	canUndoRefund: false,
	helped: false,
	batch: null,
	picture: null,
	isYou: false,
	paidAt: null,
	method: null,
	receipt: null,
	canPay: s.status === "pending" && !!(s.isYou || s.youManage),
	canAddReceipt: false,
	paidCents: s.status === "paid" || s.status === "payer" ? s.amountCents : 0,
	dueCents: s.status === "pending" ? s.amountCents : 0,
	refundCents: 0,
	participates: true,
	kind: "user",
	youManage: false,
	managedByName: null,
	...s,
});
const PAID_AT = daysAgo(1) + "T15:00:00.000Z";
const A = { uid: "a", name: "Rafael Schettino" };
const B = { uid: "b", name: "Maria das Dores Silva" };

const NO_DUE = { dueDate: null, installment: null, recurrence: null, overdue: false, series: null };

/** Série mensal de `count` parcelas a partir do vencimento da primeira; as `paid` primeiras já estão quitadas. */
function seriesMock(count: number, firstDue: string, paid: number): ExpenseSeries {
	return {
		count,
		items: Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, number: i + 1, dueDate: addMonthsClamped(firstDue, i), settled: i < paid })),
	};
}

/** Despesas do cenário da Renata (que cuida do avô Benjamim). */
function careDetail(mode: "two-parts" | "care-paid"): RawDetail {
	const R = { uid: "a", name: "Renata Souza" };
	const BEN = { uid: "m1", name: "Benjamim", kind: "managed" as const, managedByName: "Renata Souza", youManage: true };
	const common = { groupId: "1", createdAt: new Date().toISOString(), attachments: [] as ExpenseDetailData["attachments"], ...NO_DUE };
	if (mode === "two-parts") {
		// Mercado de 620,00 pago pela Maria, dividido entre 4: a Renata deve a parte dela (155,00) e a do Benjamim (já pagou 50,00; faltam 105,00).
		const shares = [
			share({ ...B, amountCents: 15500, status: "payer" }),
			share({ ...R, amountCents: 15500, status: "pending", isYou: true }),
			share({ ...BEN, amountCents: 15500, status: "pending", paidCents: 5000, dueCents: 10500 }),
			share({ uid: "c", name: "José", amountCents: 15500, status: "paid", paidAt: PAID_AT, method: "manual" }),
		];
		return {
			...common,
			id: "c2",
			description: "Mercado do mês",
			amountCents: 62000,
			date: daysAgo(2),
			canDelete: false,
			canMarkPaid: false,
			canEditParticipants: false,
			paidBy: { ...B, picture: null, isYou: false, kind: "user", youManage: false },
			pix: { type: "cpf", key: "52998224725", payeeName: B.name },
			shares,
			participantUids: shares.map((s) => s.uid),
		};
	}
	// Remédios de 289,90 pagos pelo Benjamim (a Renata age por ele), divididos entre 4.
	const shares = [
		share({ ...BEN, amountCents: 7247, status: "payer" }),
		share({ ...R, amountCents: 7248, status: "pending", isYou: true }),
		share({ ...B, amountCents: 7248, status: "paid", paidAt: PAID_AT, method: "manual" }),
		share({ uid: "c", name: "José", amountCents: 7247, status: "pending" }),
	];
	return {
		...common,
		id: "c1",
		description: "Remédios do Benjamim",
		amountCents: 28990,
		date: daysAgo(0),
		canDelete: true,
		canMarkPaid: true,
		canEditParticipants: true,
		paidBy: { uid: BEN.uid, name: BEN.name, picture: null, isYou: false, kind: "managed", youManage: true },
		pix: { type: "cpf", key: "52998224725", payeeName: BEN.name },
		shares,
		participantUids: shares.map((s) => s.uid),
	};
}

/** Parcela de uma compra parcelada, vista por quem deve (o dono é a Maria). */
function installmentDetail(mode: "installment" | "overdue"): RawDetail {
	const overdue = mode === "overdue";
	// "Em dia": parcela 2 de 6, a primeira venceu no dia 10 e já foi paga. "Vencida": parcela 2 de 4, venceu há 8 dias.
	const count = overdue ? 4 : 6;
	const due2 = overdue ? daysAgo(8) : DUE_NEXT;
	const series = seriesMock(count, addMonthsClamped(due2, -1), 1);
	const shares = [
		share({ ...B, amountCents: 3000, status: "payer" }),
		share({ ...A, amountCents: 3000, status: "pending", isYou: true }),
		share({ uid: "c", name: "José", amountCents: 3000, status: "paid", paidAt: PAID_AT, method: "manual" }),
		share({ uid: "d", name: "Ana Paula", amountCents: 3000, status: "pending" }),
	];
	return {
		id: "p2",
		groupId: "1",
		description: overdue ? "Geladeira nova" : "Sofá da sala",
		amountCents: 12000,
		date: daysAgo(overdue ? 40 : 30),
		createdAt: new Date().toISOString(),
		canDelete: false,
		canMarkPaid: false,
		canEditParticipants: false,
		paidBy: { ...B, picture: null, isYou: false, kind: "user", youManage: false },
		pix: { type: "cpf", key: "52998224725", payeeName: B.name },
		attachments: [],
		shares,
		participantUids: shares.map((x) => x.uid),
		dueDate: due2,
		installment: { seriesId: "s1", number: 2, count },
		recurrence: null,
		overdue,
		series,
	};
}

/** Compra de R$ 1.000,00 com R$ 50,00 de cashback (à vista) ou parcela 1 de 3 com cashback só na primeira, vista por quem deve. */
function cashbackDetail(installment: boolean): RawDetail {
	const net = installment ? 25000 : 95000;
	const each = installment ? 6250 : 23750;
	const shares = [
		share({ ...B, amountCents: each, status: "payer" }),
		share({ ...A, amountCents: each, status: "pending", isYou: true }),
		share({ uid: "c", name: "José", amountCents: each, status: "pending" }),
		share({ uid: "d", name: "Ana Paula", amountCents: each, status: "pending" }),
	];
	const series: ExpenseSeries = {
		count: 3,
		items: [
			{ id: "p1", number: 1, dueDate: DUE_NEXT, settled: false, amountCents: 25000 },
			{ id: "p2", number: 2, dueDate: addMonthsClamped(DUE_NEXT, 1), settled: false, amountCents: 30000 },
			{ id: "p3", number: 3, dueDate: addMonthsClamped(DUE_NEXT, 2), settled: false, amountCents: 30000 },
		],
	};
	return {
		id: "cb1",
		groupId: "1",
		description: installment ? "Geladeira nova" : "Compras do mês",
		amountCents: net,
		cashbackCents: installment ? 5000 : 5000,
		date: daysAgo(1),
		createdAt: new Date().toISOString(),
		canDelete: false,
		canMarkPaid: false,
		canEditParticipants: false,
		paidBy: { ...B, picture: null, isYou: false, kind: "user", youManage: false },
		pix: { type: "cpf", key: "52998224725", payeeName: B.name },
		attachments: [],
		shares,
		participantUids: shares.map((x) => x.uid),
		dueDate: installment ? DUE_NEXT : null,
		installment: installment ? { seriesId: "s1", number: 1, count: 3 } : null,
		recurrence: null,
		overdue: false,
		series: installment ? series : null,
	};
}

/** Despesa de um mês criada por uma despesa fixa (aluguel, dia 10), vista por quem deve. */
function monthlyDetail(): RawDetail {
	const shares = [
		share({ ...B, amountCents: 30000, status: "payer" }),
		share({ ...A, amountCents: 30000, status: "pending", isYou: true }),
		share({ uid: "c", name: "José", amountCents: 30000, status: "paid", paidAt: PAID_AT, method: "manual" }),
		share({ uid: "d", name: "Ana Paula", amountCents: 30000, status: "pending" }),
	];
	return {
		id: "r1-2026-11",
		groupId: "1",
		description: "Aluguel da casa da vó",
		amountCents: 120000,
		date: TODAY.slice(0, 7) + "-10",
		createdAt: new Date().toISOString(),
		canDelete: false,
		canMarkPaid: false,
		canEditParticipants: false,
		paidBy: { ...B, picture: null, isYou: false, kind: "user", youManage: false },
		pix: { type: "cpf", key: "52998224725", payeeName: B.name },
		attachments: [],
		shares,
		participantUids: shares.map((x) => x.uid),
		dueDate: TODAY.slice(0, 7) + "-10",
		installment: null,
		recurrence: { id: "r1", period: TODAY.slice(0, 7) },
		overdue: false,
		series: null,
	};
}

/** Parcela 2 de 6 vista por quem lançou (dono): pode mudar a divisão e apagar, e a pergunta "só esta ou as próximas" aparece. */
function ownerInstallmentDetail(): RawDetail {
	const d = installmentDetail("installment");
	const shares = [
		share({ ...A, amountCents: 3000, status: "payer", isYou: true }),
		share({ ...B, amountCents: 3000, status: "pending" }),
		share({ uid: "c", name: "José", amountCents: 3000, status: "paid", paidAt: PAID_AT, method: "manual" }),
		share({ uid: "d", name: "Ana Paula", amountCents: 3000, status: "pending" }),
	];
	return {
		...d,
		description: "Sofá da sala",
		canDelete: true,
		canMarkPaid: true,
		canEditParticipants: true,
		paidBy: { ...A, picture: null, isYou: true, kind: "user", youManage: false },
		pix: { type: "cpf", key: "52998224725", payeeName: A.name },
		shares,
		participantUids: shares.map((x) => x.uid),
	};
}

const NO_HELP = { canHelp: false, helpAsUids: [] as string[], helpShareCents: null, ownerAlone: false };

/** "Quero ajudar": quem pagou está sozinho (ou com poucos), e a pessoa que olha pode entrar na divisão. */
function helpDetail(mode: "help-alone" | "help-split" | "helped" | "help-care"): ExpenseDetailData {
	const care = mode === "help-care";
	const viewer = care ? { uid: "a", name: "Renata Souza" } : A;
	const owner = { ...B, picture: null, isYou: false, kind: "user" as const, youManage: false };
	const base = {
		id: "e1",
		groupId: "1",
		description: "Remédios da farmácia",
		amountCents: 28990,
		date: daysAgo(0),
		createdAt: new Date().toISOString(),
		canDelete: false,
		canMarkPaid: false,
		canEditParticipants: false,
		canEdit: false,
		adminOnly: false,
		paidBy: owner,
		pix: { type: "cpf" as const, key: "52998224725", payeeName: owner.name },
		launchedBy: null,
		attachments: [],
		...NO_DUE,
	};
	const finish = (shares: ExpenseShare[], extra: Partial<ExpenseDetailData>): ExpenseDetailData => ({
		...base,
		...NO_HELP,
		shares,
		participantUids: shares.filter((s) => s.participates).map((s) => s.uid),
		...extra,
	});
	switch (mode) {
		case "help-split":
			return finish(
				[
					share({ ...B, amountCents: 9663, status: "payer" }),
					share({ uid: "c", name: "José", amountCents: 9663, status: "paid", paidAt: PAID_AT, method: "manual" }),
					share({ uid: "d", name: "Ana Paula", amountCents: 9664, status: "pending" }),
				],
				{ canHelp: true, helpShareCents: 7248 },
			);
		case "helped":
			return finish(
				[
					share({ ...B, amountCents: 9663, status: "payer" }),
					share({ uid: "c", name: "José", amountCents: 9663, status: "paid", paidAt: PAID_AT, method: "manual", helped: true }),
					share({ ...viewer, amountCents: 9664, status: "pending", isYou: true, helped: true }),
				],
				{},
			);
		default:
			return finish([share({ ...B, amountCents: 28990, status: "payer" })], {
				canHelp: true,
				ownerAlone: true,
				helpShareCents: 14495,
				...(care ? { helpAsUids: ["m1", "m3"] } : {}),
			});
	}
}

function detail(mode: MockMode): ExpenseDetailData {
	if (mode === "help-alone" || mode === "help-split" || mode === "helped" || mode === "help-care") return helpDetail(mode);
	const raw = rawDetail(mode);
	const launched = mode === "admin-launched" ? { pix: null, launchedBy: { name: "Rafael Schettino", admin: true } } : {};
	return { ...NO_HELP, canEdit: raw.canMarkPaid, adminOnly: false, launchedBy: null, ...raw, ...launched, ...(mode === "admin-view" || mode === "admin-launched" ? { canEdit: true, adminOnly: true, canMarkPaid: true, canEditParticipants: true, canDelete: true } : {}) };
}

function rawDetail(mode: MockMode): RawDetail {
	if (mode === "installment" || mode === "overdue") return installmentDetail(mode);
	if (mode === "owner-installment") return ownerInstallmentDetail();
	if (mode === "monthly") return monthlyDetail();
	if (mode === "cashback" || mode === "cashback-installment") return cashbackDetail(mode === "cashback-installment");
	if (isCare(mode)) return careDetail(mode as "two-parts" | "care-paid");
	const youOwner = mode === "payer" || mode === "owner-return" || mode === "recalc" || mode === "self-owner" || mode === "refund-pay" || mode === "refund-nopix" || mode === "refund-done";
	const owner = youOwner ? { ...A, picture: null, isYou: true, kind: "user" as const, youManage: false } : { ...B, picture: null, isYou: false, kind: "user" as const, youManage: false };
	const base = {
		id: "e1",
		groupId: "1",
		createdAt: new Date().toISOString(),
		canDelete: youOwner,
		canMarkPaid: youOwner,
		canEditParticipants: youOwner,
		paidBy: owner,
		pix: { type: "cpf" as const, key: "52998224725", payeeName: owner.name },
		attachments: ATTACHMENTS.map(({ id, name, contentType, size }) => ({ id, name, contentType, size })),
		...NO_DUE,
	};
	const out = (description: string, amountCents: number, dayAgo: number, shares: ExpenseShare[]): RawDetail => ({
		...base,
		description,
		amountCents,
		date: daysAgo(dayAgo),
		shares,
		participantUids: shares.filter((s) => s.participates).map((s) => s.uid),
	});
	const RECEIPT = { name: "comprovante-pix.png", contentType: "image/png", size: 210_000 };
	const MARIA_PIX = { type: "cpf" as const, key: "11144477735", payeeName: B.name };
	switch (mode) {
		case "admin-view":
		case "admin-launched":
			// Rafael administra o grupo; a Maria pagou a conta. O José foi marcado como pago pelo Rafael (admin).
			return out("Consulta com a cardiologista", 45000, 1, [
				share({ ...B, amountCents: 15000, status: "payer" }),
				share({ ...A, amountCents: 15000, status: "pending", isYou: true }),
				share({ uid: "c", name: "José", amountCents: 15000, status: "paid", paidAt: PAID_AT, method: "manual", markedByAdmin: true, markedByName: "Rafael Schettino" }),
			]);
		case "refund-pay":
		case "refund-nopix":
			// Rafael pagou a conta; a Maria pagou 200,00 por uma parte que agora é de 150,00: Rafael deve devolver 50,00.
			return out("Consulta com a cardiologista", 45000, 1, [
				share({ ...A, amountCents: 15000, status: "payer", isYou: true }),
				share({ ...B, amountCents: 15000, status: "refund", paidCents: 20000, refundCents: 5000, paidAt: PAID_AT, method: "self", canRefund: true, refundPix: mode === "refund-nopix" ? null : MARIA_PIX }),
				share({ uid: "c", name: "José", amountCents: 15000, status: "pending" }),
			]);
		case "refund-done":
			return out("Consulta com a cardiologista", 45000, 1, [
				share({ ...A, amountCents: 15000, status: "payer", isYou: true }),
				share({ ...B, amountCents: 15000, status: "paid", paidCents: 15000, paidAt: PAID_AT, method: "self", receipt: RECEIPT, refund: { cents: 5000, at: PAID_AT, byAdmin: false, markedByName: null, receipt: { name: "devolucao-pix.png", contentType: "image/png", size: 190_000 }, batch: null }, canUndoRefund: true }),
				share({ uid: "d", name: "Ana Paula", amountCents: 0, status: "paid", paidCents: 0, participates: false, refund: { cents: 11250, at: PAID_AT, byAdmin: true, markedByName: "Rafael Schettino", receipt: null, batch: null }, canUndoRefund: true }),
				share({ uid: "c", name: "José", amountCents: 15000, status: "pending" }),
			]);
		case "batch":
			// Rafael pagou 3 contas de uma vez para Maria (R$ 350,00 no total) e enviou um comprovante só.
			return out("Remédios da farmácia", 28990, 2, [
				share({ ...B, amountCents: 7247, status: "payer" }),
				share({ ...A, amountCents: 7248, status: "paid", isYou: true, paidAt: PAID_AT, method: "self", receipt: RECEIPT, canAddReceipt: true, batch: { totalCents: 35000, count: 3 } }),
				share({ uid: "c", name: "José", amountCents: 7248, status: "paid", paidAt: PAID_AT, method: "manual" }),
				share({ uid: "d", name: "Ana Paula", amountCents: 7247, status: "pending" }),
			]);
		case "self-owner":
			// Rafael pagou a conta: Maria avisou que pagou (com comprovante); José ainda não.
			return out("Consulta com a cardiologista", 45000, 1, [
				share({ ...A, amountCents: 15000, status: "payer", isYou: true }),
				share({ ...B, amountCents: 15000, status: "paid", paidAt: PAID_AT, method: "self", receipt: RECEIPT }),
				share({ uid: "c", name: "José", amountCents: 15000, status: "pending" }),
			]);
		case "self-debtor":
			// Rafael avisou que pagou, sem comprovante: ainda pode anexar.
			return out("Remédios da farmácia", 28990, 0, [
				share({ ...B, amountCents: 7247, status: "payer" }),
				share({ ...A, amountCents: 7248, status: "paid", isYou: true, paidAt: PAID_AT, method: "self", canAddReceipt: true }),
				share({ uid: "c", name: "José", amountCents: 7248, status: "paid", paidAt: PAID_AT, method: "manual" }),
				share({ uid: "d", name: "Ana Paula", amountCents: 7247, status: "pending" }),
			]);
		case "debtor":
			return out("Remédios da farmácia", 28990, 0, [
				share({ ...B, amountCents: 7247, status: "payer" }),
				share({ ...A, amountCents: 7248, status: "pending", isYou: true }),
				share({ uid: "c", name: "José", amountCents: 7248, status: "paid", paidAt: PAID_AT, method: "manual" }),
				share({ uid: "d", name: "Ana Paula", amountCents: 7247, status: "pending" }),
			]);
		case "partial":
			// 300,00 entre Maria, Rafael e José; Rafael já tinha pago 40,00; Ana saiu depois de pagar 75,00
			return out("Mercado do mês", 30000, 3, [
				share({ ...B, amountCents: 10000, status: "payer" }),
				share({ ...A, amountCents: 10000, status: "pending", isYou: true, paidCents: 4000, dueCents: 6000 }),
				share({ uid: "c", name: "José", amountCents: 10000, status: "paid", paidAt: PAID_AT, method: "manual" }),
				share({ uid: "d", name: "Ana Paula", amountCents: 0, status: "refund", paidCents: 7500, refundCents: 7500, participates: false }),
			]);
		case "refund":
			return out("Ração e areia da gata", 18000, 2, [
				share({ ...B, amountCents: 6000, status: "payer" }),
				share({ ...A, amountCents: 6000, status: "refund", isYou: true, paidCents: 7500, refundCents: 1500 }),
				share({ uid: "c", name: "José", amountCents: 6000, status: "pending" }),
			]);
		case "owner-return":
			// 450,00 entre Rafael, Maria e José; Maria pagou 200,00 (parte agora 150,00); Ana saiu depois de pagar 112,50
			return out("Consulta com a cardiologista", 45000, 1, [
				share({ ...A, amountCents: 15000, status: "payer", isYou: true }),
				share({ ...B, amountCents: 15000, status: "refund", paidCents: 20000, refundCents: 5000 }),
				share({ uid: "c", name: "José", amountCents: 15000, status: "pending", paidCents: 5000, dueCents: 10000 }),
				share({ uid: "d", name: "Ana Paula", amountCents: 0, status: "refund", paidCents: 11250, refundCents: 11250, participates: false }),
			]);
		case "recalc":
			return out("Consulta com a cardiologista", 45000, 1, [
				share({ ...A, amountCents: 11250, status: "payer", isYou: true }),
				share({ ...B, amountCents: 11250, status: "paid", paidAt: PAID_AT, method: "manual" }),
				share({ uid: "c", name: "José", amountCents: 11250, status: "pending" }),
				share({ uid: "d", name: "Ana Paula", amountCents: 11250, status: "paid", paidAt: PAID_AT, method: "manual" }),
			]);
		default:
			return out("Consulta com a cardiologista", 45000, 1, [
				share({ ...A, amountCents: 11250, status: "payer", isYou: true }),
				share({ ...B, amountCents: 11250, status: "paid", paidAt: PAID_AT, method: "manual" }),
				share({ uid: "c", name: "José", amountCents: 11250, status: "pending" }),
				share({ uid: "d", name: "Ana Paula", amountCents: 11250, status: "pending" }),
			]);
	}
}

export function MockExpense({
	mode,
	confirm,
	qrOpen: qrInitial = false,
	codeFallback = false,
	framed = true,
	resplit,
	shareSheet = false,
	scopeSheet,
	helpSheet = false,
	receiptSheet,
	summarySheet = false,
}: Readonly<{
	mode: MockMode;
	/** Abre o sheet "Compartilhar resumo" desta despesa. */
	summarySheet?: boolean;
	/** Abre o sheet "Já paguei" (pay) ou "Anexar comprovante" (attach), vazio ou com um arquivo escolhido. */
	receiptSheet?: { mode: ReceiptMode; filled?: boolean };
	/** Abre o sheet "Quero ajudar". */
	helpSheet?: boolean;
	/** Abre a pergunta "só esta parcela ou esta e as próximas" (ao apagar ou ao mudar quem divide). */
	scopeSheet?: "delete" | "resplit";
	qrOpen?: boolean;
	codeFallback?: boolean;
	framed?: boolean;
	/** Abre o confirmar de marcar pago / devolvi / desfazer na parte de alguém. */
	confirm?: { uid: string; mode: "paid" | "pending" | "refund" };
	/** Abre o sheet "Mudar quem divide" com estas pessoas marcadas. */
	resplit?: string[];
	/** Abre o sheet "Despesa lançada!". */
	shareSheet?: boolean;
}>) {
	const [qrOpen, setQrOpen] = useState<string | null>(qrInitial ? "a" : null);
	const [action, setAction] = useState(confirm ?? null);
	const [shareOpen, setShareOpen] = useState(shareSheet);
	const [summaryOpen, setSummaryOpen] = useState(summarySheet);
	const [helpOpen, setHelpOpen] = useState(helpSheet);
	const [helpWho, setHelpWho] = useState("eu");
	const [resplitOpen, setResplitOpen] = useState(!!resplit);
	const [scopeStep, setScopeStep] = useState<"delete" | "resplit" | null>(scopeSheet ?? null);
	const [scope, setScope] = useState<InstallmentScope>("this");
	const [receiptOpen, setReceiptOpen] = useState<ReceiptMode | null>(receiptSheet?.mode ?? null);
	const [receiptItems, setReceiptItems] = useState<PickedFile[]>(() =>
		receiptSheet?.filled
			? [{ id: "r1", file: new File([new Blob(["x".repeat(210_000)])], "comprovante-pix.png", { type: "image/png" }), kind: "image", previewUrl: svgReceipt("#e6eef7") }]
			: [],
	);
	const [receiptView, setReceiptView] = useState(false);
	const expense = detail(mode);
	const members = (isCare(mode) ? CARE_GROUP : MOCK_GROUP).members.map(({ uid, name, picture, isYou, kind }) => ({ uid, name, picture, isYou, kind }));
	const who = useWhoSplits(members.map((m) => m.uid), resplit ?? expense.participantUids);
	const target = action ? expense.shares.find((s) => s.uid === action.uid) : undefined;
	const text = buildExpenseShareText(expense, expenseShareLink("launched", "https://pague-sua-parte.app", "abc123", "1", "e1"));
	return (
		<Shell pathname="/app/grupos/1/despesas/e1" framed={framed} user={isCare(mode) ? CARE_USER : USER}>
			<ExpenseDetailView
				expense={expense}
				attachments={isCare(mode) || mode === "monthly" ? [] : ATTACHMENTS}
				qrOpen={qrOpen}
				codeFallback={codeFallback ? "a" : null}
				onToggleQr={(uid) => setQrOpen((o) => (o === uid ? null : uid))}
				onCopyCode={noop}
				onCopyKey={noop}
				onOpenImage={noop}
				onOpenPdf={noop}
				onAskDelete={() => setScopeStep("delete")}
				onMarkPaid={(uid) => setAction({ uid, mode: "paid" })}
				onUndoPaid={(uid) => setAction({ uid, mode: "pending" })}
				onGiveBack={(uid) => (mode.startsWith("refund") ? setReceiptOpen("refund") : setAction({ uid, mode: "refund" }))}
				onEditParticipants={() => (expense.installment ? setScopeStep("resplit") : setResplitOpen(true))}
				onShare={() => setShareOpen(true)}
				onHelp={() => setHelpOpen(true)}
				onPaid={() => setReceiptOpen("pay")}
				onViewReceipt={() => setReceiptView(true)}
				onAttachReceipt={() => setReceiptOpen("attach")}
				onTellPaid={() => {}}
				onEdit={noop}
				onShareSummary={() => setSummaryOpen(true)}
			/>
			<Sheet open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Compartilhar resumo">
				<ShareExpenseContent
					text={buildExpenseStatusText(expense, expenseShareLink("launched", "https://pague-sua-parte.app", "abc123", "1", "e1"))}
					intro={expenseSummaryIntro()}
					canShare
					copyFailed={false}
					dismissLabel="Fechar"
					whatsappLabel="Compartilhar no WhatsApp"
					preview
					onCopy={noop}
					onShare={noop}
					onClose={() => setSummaryOpen(false)}
				/>
			</Sheet>
			<Sheet open={receiptOpen !== null} onClose={() => setReceiptOpen(null)} title={receiptOpen === "attach" ? "Anexar comprovante" : receiptOpen === "refund" ? "Devolvi" : "Já paguei"}>
				{receiptOpen && (
					<ReceiptSheetContent
						mode={receiptOpen}
						payeeName={receiptOpen === "refund" ? "Maria das Dores Silva" : (expense.pix?.payeeName ?? "")}
						items={receiptItems}
						problems={[]}
						processing={false}
						dragging={false}
						canPaste
						busy={false}
						error={null}
						fileError={null}
						onPick={noop}
						onRemove={() => setReceiptItems([])}
						onPaste={noop}
						onSend={() => setReceiptOpen(null)}
						onSkip={() => setReceiptOpen(null)}
						onCancel={() => setReceiptOpen(null)}
					/>
				)}
			</Sheet>
			<Sheet open={receiptView} onClose={() => setReceiptView(false)} title="Comprovante">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={svgReceipt("#e6eef7")} alt="Comprovante" className="max-h-[65dvh] w-full rounded-shape-md bg-surface-container-high object-contain" />
				<Button variant="tonal" fullWidth onClick={() => setReceiptView(false)} className="mt-4">
					Fechar
				</Button>
			</Sheet>
			<Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Quero ajudar">
				<HelpContent
					expense={expense}
					options={helperOptions(expense, Object.fromEntries(CARE_GROUP.members.map((m) => [m.uid, { name: m.name, picture: m.picture }])))}
					who={helpWho}
					busy={false}
					error={null}
					onWho={setHelpWho}
					onConfirm={() => setHelpOpen(false)}
					onCancel={() => setHelpOpen(false)}
				/>
			</Sheet>
			<Sheet open={!!(action && target)} onClose={() => setAction(null)} title={action && target ? sharePaidTitle(action.mode, target) : ""}>
				{action && <SharePaidContent mode={action.mode} busy={false} error={null} onConfirm={() => setAction(null)} onCancel={() => setAction(null)} />}
			</Sheet>
			<Sheet open={scopeStep === "resplit"} onClose={() => setScopeStep(null)} title="Mudar quem divide">
				{expense.installment && (
					<ResplitScopeContent
						scope={scope}
						number={expense.installment.number}
						count={expense.installment.count}
						onScope={setScope}
						onContinue={() => {
							setScopeStep(null);
							setResplitOpen(true);
						}}
						onCancel={() => setScopeStep(null)}
					/>
				)}
			</Sheet>
			<Sheet open={scopeStep === "delete"} onClose={() => setScopeStep(null)} title="Apagar qual parcela?">
				{expense.installment && (
					<DeleteInstallmentContent
						scope={scope}
						number={expense.installment.number}
						count={expense.installment.count}
						busy={false}
						error={null}
						onScope={setScope}
						onConfirm={() => setScopeStep(null)}
						onCancel={() => setScopeStep(null)}
					/>
				)}
			</Sheet>
			<Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Despesa lançada!">
				<ShareExpenseContent
					text={text}
					intro={shareIntro("launched", expense.installment?.count)}
					canShare
					copyFailed={false}
					onCopy={noop}
					onShare={noop}
					onClose={() => setShareOpen(false)}
				/>
			</Sheet>
			<Sheet tall open={resplitOpen} onClose={() => setResplitOpen(false)} title="Mudar quem divide">
				<ResplitContent
					expense={expense}
					members={members}
					selected={who.selected}
					mode={who.mode}
					busy={false}
					error={null}
					onMode={who.setMode}
					onToggle={who.toggle}
					onConfirm={() => setResplitOpen(false)}
					onCancel={() => setResplitOpen(false)}
				/>
			</Sheet>
		</Shell>
	);
}

export const MOCK_GROUPS: GroupSummary[] = ([
	{ id: "1", name: "Despesas da vó", memberCount: 4, role: "admin", toReceiveCents: 34500, toPayCents: 0 },
	{ id: "2", name: "Viagem a Floripa", memberCount: 5, role: "member", toReceiveCents: 12850, toPayCents: 4590 },
	{ id: "3", name: "Casa de praia da família Silva Albuquerque", memberCount: 1, role: "admin", toReceiveCents: 0, toPayCents: 128000 },
	{ id: "4", name: "Natal", memberCount: 8, role: "member", toReceiveCents: 0, toPayCents: 0 },
] as Parameters<typeof normalizeGroup>[0][]).map(normalizeGroup);

/** Grupos com vencimentos: um com valor vencido, um com parte só nos meses que vêm, um sem nada especial. */
export const DUE_GROUPS: GroupSummary[] = [
	normalizeGroup({ id: "1", name: "Despesas da vó", memberCount: 4, role: "admin", toReceiveCents: 34500, toReceiveNowCents: 12000, toPayCents: 21000, toPayNowCents: 9000, overdueToPayCents: 3000 }),
	normalizeGroup({ id: "2", name: "Viagem a Floripa", memberCount: 5, role: "member", toReceiveCents: 12850, toPayCents: 45900, toPayNowCents: 15300 }),
	normalizeGroup({ id: "3", name: "Natal", memberCount: 8, role: "member", toReceiveCents: 0, toPayCents: 0 }),
];

/** Tela inicial com saldos por grupo; `chooser` abre o sheet "Em qual grupo?" (ou o aviso de que falta criar um grupo). */
export function MockHome({
	framed = true,
	chooser = false,
	groups = MOCK_GROUPS,
	managed = [],
	summary,
	children,
}: Readonly<{
	/** Seções extras no fim do início (ex.: Planos). */
	children?: React.ReactNode;
	framed?: boolean;
	chooser?: boolean;
	groups?: GroupSummary[];
	managed?: React.ComponentProps<typeof ManagedSummaryCards>["managed"];
	/** Totais com vencimentos ("até o fim do mês" e vencido). */
	summary?: Partial<React.ComponentProps<typeof HomeSummary>>;
}>) {
	const [open, setOpen] = useState(chooser);
	return (
		<Shell pathname="/app" framed={framed} user={managed.length > 0 ? CARE_USER : USER}>
			<div className="space-y-6">
				<h1 className="text-headline-medium md:text-headline-large">Olá, {managed.length > 0 ? "Renata" : "Rafael"}!</h1>
				<div className="space-y-3">
					<HomeSummary receiveCents={47350} payCents={132590} {...summary} />
					<ManagedSummaryCards managed={managed} />
				</div>
				<GroupsListView state={{ kind: "ready", groups }} onPostExpense={() => setOpen(true)} />
				{children}
				<ChooseGroupSheet open={open} onClose={() => setOpen(false)} groups={groups} />
			</div>
		</Shell>
	);
}


const P = (o: Partial<ReportData["people"][number]> & Pick<ReportData["people"][number], "uid" | "name" | "bornCents">): ReportData["people"][number] => ({
	picture: null,
	kind: "user",
	isYou: false,
	youManage: false,
	stillMember: true,
	advancedCents: 0,
	shareCents: 0,
	pendingCents: 0,
	owedBackCents: 0,
	helpedCount: 0,
	expensesPaidCount: 0,
	bornPercent: 0,
	...o,
});
const withPercent = (people: ReturnType<typeof P>[]): ReturnType<typeof P>[] => {
	const total = people.reduce((s, p) => s + p.bornCents, 0) || 1;
	return people.map((p) => ({ ...p, bornPercent: Math.round((p.bornCents / total) * 10000) }));
};
const MONTHS = [
	{ month: "2026-06", totalCents: 82000 },
	{ month: "2026-07", totalCents: 61500 },
	{ month: "2026-08", totalCents: 140000 },
	{ month: "2026-09", totalCents: 97000 },
	{ month: "2026-10", totalCents: 123000 },
	{ month: "2026-11", totalCents: 88500 },
];
/** Seis pessoas, bem divididas. */
const REPORT_EVEN: ReportData = {
	period: "all",
	groupName: "Despesas da vó",
	expenseCount: 23,
	totalCents: 592000,
	equalShareCents: 98667,
	fairnessPercent: 91,
	months: MONTHS,
	people: withPercent([
		P({ uid: "b", name: "Maria das Dores Silva", bornCents: 112000, advancedCents: 160000, expensesPaidCount: 9, pendingCents: 0, helpedCount: 2 }),
		P({ uid: "a", name: "Rafael Schettino", isYou: true, bornCents: 104000, advancedCents: 120000, expensesPaidCount: 6, pendingCents: 9800 }),
		P({ uid: "c", name: "José", bornCents: 98000, advancedCents: 90000, expensesPaidCount: 5, helpedCount: 1 }),
		P({ uid: "d", name: "Ana Paula", bornCents: 96000, pendingCents: 12000 }),
		P({ uid: "m1", name: "Benjamim", kind: "managed", bornCents: 94000, advancedCents: 40000, expensesPaidCount: 2 }),
		P({ uid: "e", name: "Tio Carlos", stillMember: false, bornCents: 88000 }),
	]),
};
/** Seis pessoas, uma carregando quase tudo, com nomes longos. */
const REPORT_UNEVEN: ReportData = {
	period: "all",
	groupName: "Despesas da vó",
	expenseCount: 31,
	totalCents: 1264000,
	equalShareCents: 210667,
	fairnessPercent: 42,
	months: MONTHS,
	people: withPercent([
		P({ uid: "b", name: "Maria das Dores Silva de Albuquerque Santos", bornCents: 690000, advancedCents: 820000, expensesPaidCount: 19, pendingCents: 0 }),
		P({ uid: "a", name: "Rafael Schettino", isYou: true, bornCents: 310000, advancedCents: 350000, expensesPaidCount: 8, helpedCount: 3, pendingCents: 21000 }),
		P({ uid: "c", name: "José", bornCents: 130000, advancedCents: 94000, expensesPaidCount: 4 }),
		P({ uid: "d", name: "Ana Paula", bornCents: 64000, pendingCents: 86000 }),
		P({ uid: "m1", name: "Benjamim", kind: "managed", bornCents: 50000, pendingCents: 31000 }),
		P({ uid: "e", name: "Tio Carlos Eduardo da Silva", kind: "managed", stillMember: false, bornCents: 20000 }),
	]),
};
const REPORT_EMPTY: ReportData = { period: "month:2026-11", groupName: "Despesas da vó", expenseCount: 0, totalCents: 0, equalShareCents: 0, fairnessPercent: 0, people: [], months: [] };

export function MockReport({
	variant = "even",
	state: stateOverride,
}: Readonly<{ variant?: "even" | "uneven" | "empty"; state?: ReportState }>) {
	const [period, setPeriod] = useState<import("@/lib/ui/report").ReportPeriod>(variant === "empty" ? "month:2026-11" : "all");
	const data = variant === "even" ? REPORT_EVEN : variant === "uneven" ? REPORT_UNEVEN : REPORT_EMPTY;
	return (
		<Shell pathname="/app/grupos/1/relatorio" framed={false}>
			<ReportView
				groupId="1"
				state={stateOverride ?? { kind: "ready", data }}
				period={period}
				onPeriod={setPeriod}
				today="2026-11-11"
			/>
		</Shell>
	);
}
