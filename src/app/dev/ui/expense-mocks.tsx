"use client";

import { useState } from "react";
import { AppShellView } from "@/components/app-shell";
import { AttachmentPicker } from "@/components/expenses/attachment-picker";
import { ExpenseDetailView, SharePaidContent, sharePaidTitle } from "@/components/expenses/expense-detail";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { ResplitContent } from "@/components/expenses/resplit-sheet";
import { useWhoSplits } from "@/components/expenses/who-splits";
import { ChooseGroupSheet, GroupsListView, type GroupSummary } from "@/components/groups/groups-list";
import { HomeSummary } from "@/components/home-summary";
import { buildExpenseShareText } from "@/lib/ui/expense-share";
import type { AttachmentView } from "@/components/expenses/expense-attachments";
import { ExpenseListView } from "@/components/expenses/expense-list";
import { NewExpenseFormView, NoPixKeyBlock, type FormErrors } from "@/components/expenses/new-expense-form";
import type { ExpenseDetailData, ExpenseShare, ExpenseSummary } from "@/components/expenses/types";
import { useAttachments } from "@/components/expenses/use-attachments";
import { GroupDetailView, type Group } from "@/components/groups/group-detail";
import { Button, Sheet } from "@/components/ui";
import { todayISO } from "@/lib/ui/dates";

const noop = () => {};
const USER = { name: "Rafael Schettino", email: "rafael@example.com", picture: null };

export const MOCK_GROUP: Group = {
	id: "1",
	name: "Despesas da vó",
	role: "admin",
	members: [
		{ uid: "a", name: "Rafael Schettino", picture: null, role: "admin", hasPixKey: true, isYou: true },
		{ uid: "b", name: "Maria das Dores Silva", picture: null, role: "member", hasPixKey: true, isYou: false },
		{ uid: "c", name: "José", picture: null, role: "member", hasPixKey: true, isYou: false },
		{ uid: "d", name: "Ana Paula", picture: null, role: "member", hasPixKey: false, isYou: false },
	],
};

const TODAY = todayISO();
const daysAgo = (n: number) => {
	const d = new Date(`${TODAY}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
};

const sum = (o: Omit<ExpenseSummary, "yourDueCents" | "yourRefundCents" | "refundCount"> & Partial<ExpenseSummary>): ExpenseSummary => ({
	yourDueCents: o.yourStatus === "pending" ? o.yourShareCents : 0,
	yourRefundCents: 0,
	refundCount: 0,
	...o,
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

function Shell({ pathname, children, framed }: Readonly<{ pathname: string; children: React.ReactNode; framed: boolean }>) {
	return (
		<AppShellView pathname={pathname} user={USER} onSignOut={noop} className={framed ? "min-h-0!" : undefined}>
			{children}
		</AppShellView>
	);
}

export function MockGroup({ empty = false, framed = true }: Readonly<{ empty?: boolean; framed?: boolean }>) {
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
				expenses={<ExpenseListView groupId="1" state={{ kind: "ready", expenses: empty ? [] : EXPENSES }} />}
			/>
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
}: Readonly<{
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
	const who = useWhoSplits(members.map((m) => m.uid));
	const [started, setStarted] = useState(false);
	if (!started && choose) {
		setStarted(true);
		who.setMode("choose");
		for (const uid of members.map((m) => m.uid)) if (!choose.includes(uid)) who.toggle(uid);
	}
	const att = useAttachments();
	return (
		<Shell pathname="/app/grupos/1/despesas/nova" framed={framed}>
			<NewExpenseFormView
				members={members}
				amountCents={amountCents}
				description={description}
				date={date}
				dateOpen={dateOpen}
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

export type MockMode = "debtor" | "payer" | "partial" | "refund" | "owner-return" | "recalc";

type MS = Partial<ExpenseShare> & Pick<ExpenseShare, "uid" | "name" | "amountCents" | "status">;
const share = (s: MS): ExpenseShare => ({
	picture: null,
	isYou: false,
	paidAt: null,
	method: null,
	paidCents: s.status === "paid" || s.status === "payer" ? s.amountCents : 0,
	dueCents: s.status === "pending" ? s.amountCents : 0,
	refundCents: 0,
	participates: true,
	...s,
});
const PAID_AT = daysAgo(1) + "T15:00:00.000Z";
const A = { uid: "a", name: "Rafael Schettino" };
const B = { uid: "b", name: "Maria das Dores Silva" };

function detail(mode: MockMode): ExpenseDetailData {
	const youOwner = mode === "payer" || mode === "owner-return" || mode === "recalc";
	const owner = youOwner ? { ...A, picture: null, isYou: true } : { ...B, picture: null, isYou: false };
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
	};
	const out = (description: string, amountCents: number, dayAgo: number, shares: ExpenseShare[]): ExpenseDetailData => ({
		...base,
		description,
		amountCents,
		date: daysAgo(dayAgo),
		shares,
		participantUids: shares.filter((s) => s.participates).map((s) => s.uid),
	});
	switch (mode) {
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
}: Readonly<{
	mode: MockMode;
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
	const [qrOpen, setQrOpen] = useState(qrInitial);
	const [action, setAction] = useState(confirm ?? null);
	const [shareOpen, setShareOpen] = useState(shareSheet);
	const [resplitOpen, setResplitOpen] = useState(!!resplit);
	const expense = detail(mode);
	const members = MOCK_GROUP.members.map(({ uid, name, picture, isYou }) => ({ uid, name, picture, isYou }));
	const who = useWhoSplits(members.map((m) => m.uid), resplit ?? expense.participantUids);
	const target = action ? expense.shares.find((s) => s.uid === action.uid) : undefined;
	const text = buildExpenseShareText(expense, "https://pague-sua-parte.app/app/grupos/1/despesas/e1");
	return (
		<Shell pathname="/app/grupos/1/despesas/e1" framed={framed}>
			<ExpenseDetailView
				expense={expense}
				attachments={ATTACHMENTS}
				qrOpen={qrOpen}
				codeFallback={codeFallback}
				onToggleQr={() => setQrOpen((o) => !o)}
				onCopyCode={noop}
				onCopyKey={noop}
				onOpenImage={noop}
				onOpenPdf={noop}
				onAskDelete={noop}
				onMarkPaid={(uid) => setAction({ uid, mode: "paid" })}
				onUndoPaid={(uid) => setAction({ uid, mode: "pending" })}
				onGiveBack={(uid) => setAction({ uid, mode: "refund" })}
				onEditParticipants={() => setResplitOpen(true)}
				onShare={() => setShareOpen(true)}
			/>
			<Sheet open={!!(action && target)} onClose={() => setAction(null)} title={action && target ? sharePaidTitle(action.mode, target) : ""}>
				{action && <SharePaidContent mode={action.mode} busy={false} error={null} onConfirm={() => setAction(null)} onCancel={() => setAction(null)} />}
			</Sheet>
			<Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Despesa lançada!">
				<ShareExpenseContent
					text={text}
					intro="Avise o grupo para cada um pagar a sua parte."
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

export const MOCK_GROUPS: GroupSummary[] = [
	{ id: "1", name: "Despesas da vó", memberCount: 4, role: "admin", toReceiveCents: 34500, toPayCents: 0 },
	{ id: "2", name: "Viagem a Floripa", memberCount: 5, role: "member", toReceiveCents: 12850, toPayCents: 4590 },
	{ id: "3", name: "Casa de praia da família Silva Albuquerque", memberCount: 1, role: "admin", toReceiveCents: 0, toPayCents: 128000 },
	{ id: "4", name: "Natal", memberCount: 8, role: "member", toReceiveCents: 0, toPayCents: 0 },
];

/** Tela inicial com saldos por grupo; `chooser` abre o sheet "Em qual grupo?" (ou o aviso de que falta criar um grupo). */
export function MockHome({ framed = true, chooser = false, groups = MOCK_GROUPS }: Readonly<{ framed?: boolean; chooser?: boolean; groups?: GroupSummary[] }>) {
	const [open, setOpen] = useState(chooser);
	return (
		<Shell pathname="/app" framed={framed}>
			<div className="space-y-6">
				<h1 className="text-headline-medium md:text-headline-large">Olá, Rafael!</h1>
				<HomeSummary receiveCents={47350} payCents={132590} />
				<GroupsListView state={{ kind: "ready", groups }} onPostExpense={() => setOpen(true)} />
				<ChooseGroupSheet open={open} onClose={() => setOpen(false)} groups={groups} />
			</div>
		</Shell>
	);
}
