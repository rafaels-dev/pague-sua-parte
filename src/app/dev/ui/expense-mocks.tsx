"use client";

import { useState } from "react";
import { AppShellView } from "@/components/app-shell";
import { AttachmentPicker } from "@/components/expenses/attachment-picker";
import { ExpenseDetailView, SharePaidContent, sharePaidTitle } from "@/components/expenses/expense-detail";
import type { AttachmentView } from "@/components/expenses/expense-attachments";
import { ExpenseListView } from "@/components/expenses/expense-list";
import { NewExpenseFormView, NoPixKeyBlock, type FormErrors } from "@/components/expenses/new-expense-form";
import type { ExpenseDetailData, ExpenseSummary } from "@/components/expenses/types";
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

const EXPENSES: ExpenseSummary[] = [
	{ id: "e1", description: "Remédios da farmácia", amountCents: 28990, date: daysAgo(0), paidBy: { uid: "b", name: "Maria das Dores Silva", isYou: false }, yourShareCents: 7248, yourStatus: "pending", pendingCount: 3, attachmentCount: 2 },
	{ id: "e2", description: "Consulta com a cardiologista", amountCents: 45000, date: daysAgo(1), paidBy: { uid: "a", name: "Rafael Schettino", isYou: true }, yourShareCents: 11250, yourStatus: "payer", pendingCount: 2, attachmentCount: 1 },
	{ id: "e3", description: "Fraldas geriátricas", amountCents: 12000, date: daysAgo(9), paidBy: { uid: "c", name: "José", isYou: false }, yourShareCents: 3000, yourStatus: "paid", pendingCount: 1, attachmentCount: 0 },
	{ id: "e4", description: "Exame de sangue e raio-x do tornozelo na clínica", amountCents: 31050, date: daysAgo(40), paidBy: { uid: "a", name: "Rafael Schettino", isYou: true }, yourShareCents: 7762, yourStatus: "payer", pendingCount: 0, attachmentCount: 3 },
	{ id: "e5", description: "Cuidadora de sábado", amountCents: 20000, date: "2025-06-14", paidBy: { uid: "d", name: "Ana Paula", isYou: false }, yourShareCents: 0, yourStatus: "none", pendingCount: 2, attachmentCount: 0 },
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
}: Readonly<{ framed?: boolean; errors?: FormErrors; initial?: { amountCents: number; description: string } }>) {
	const [amountCents, setAmountCents] = useState(initial?.amountCents ?? 0);
	const [description, setDescription] = useState(initial?.description ?? "");
	const [date, setDate] = useState(TODAY);
	const [dateOpen, setDateOpen] = useState(false);
	const [selected, setSelected] = useState(MOCK_GROUP.members.map((m) => m.uid));
	const att = useAttachments();
	return (
		<Shell pathname="/app/grupos/1/despesas/nova" framed={framed}>
			<NewExpenseFormView
				members={MOCK_GROUP.members}
				amountCents={amountCents}
				description={description}
				date={date}
				dateOpen={dateOpen}
				selected={selected}
				errors={errors}
				busy={false}
				onAmount={setAmountCents}
				onDescription={setDescription}
				onDate={setDate}
				onOpenDate={() => setDateOpen(true)}
				onToggle={(uid) => setSelected((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : [...s, uid]))}
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

function detail(mode: "debtor" | "payer"): ExpenseDetailData {
	const debtor = mode === "debtor";
	return {
		id: "e1",
		groupId: "1",
		description: debtor ? "Remédios da farmácia" : "Consulta com a cardiologista",
		amountCents: debtor ? 28990 : 45000,
		date: daysAgo(debtor ? 0 : 1),
		createdAt: new Date().toISOString(),
		canDelete: !debtor,
		canMarkPaid: !debtor,
		paidBy: debtor
			? { uid: "b", name: "Maria das Dores Silva", picture: null, isYou: false }
			: { uid: "a", name: "Rafael Schettino", picture: null, isYou: true },
		pix: { type: "cpf", key: "52998224725", payeeName: debtor ? "Maria das Dores Silva" : "Rafael Schettino" },
		shares: debtor
			? [
					{ uid: "b", name: "Maria das Dores Silva", picture: null, amountCents: 7247, status: "payer", isYou: false, paidAt: null, method: null },
					{ uid: "a", name: "Rafael Schettino", picture: null, amountCents: 7248, status: "pending", isYou: true, paidAt: null, method: null },
					{ uid: "c", name: "José", picture: null, amountCents: 7248, status: "paid", isYou: false, paidAt: daysAgo(1) + "T15:00:00.000Z", method: "manual" },
					{ uid: "d", name: "Ana Paula", picture: null, amountCents: 7247, status: "pending", isYou: false, paidAt: null, method: null },
				]
			: [
					{ uid: "a", name: "Rafael Schettino", picture: null, amountCents: 11250, status: "payer", isYou: true, paidAt: null, method: null },
					{ uid: "b", name: "Maria das Dores Silva", picture: null, amountCents: 11250, status: "paid", isYou: false, paidAt: daysAgo(1) + "T15:00:00.000Z", method: "manual" },
					{ uid: "c", name: "José", picture: null, amountCents: 11250, status: "pending", isYou: false, paidAt: null, method: null },
					{ uid: "d", name: "Ana Paula", picture: null, amountCents: 11250, status: "pending", isYou: false, paidAt: null, method: null },
				],
		attachments: ATTACHMENTS.map(({ id, name, contentType, size }) => ({ id, name, contentType, size })),
	};
}

export function MockExpense({
	mode,
	confirm,
	qrOpen: qrInitial = false,
	codeFallback = false,
	framed = true,
}: Readonly<{
	mode: "debtor" | "payer";
	qrOpen?: boolean;
	codeFallback?: boolean;
	framed?: boolean;
	/** Abre o sheet de confirmação para marcar (paid) ou desfazer (pending) a parte de alguém. */
	confirm?: { uid: string; mode: "paid" | "pending" };
}>) {
	const [qrOpen, setQrOpen] = useState(qrInitial);
	const [action, setAction] = useState(confirm ?? null);
	const expense = detail(mode);
	const target = action ? expense.shares.find((s) => s.uid === action.uid) : undefined;
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
			/>
			<Sheet open={!!(action && target)} onClose={() => setAction(null)} title={action && target ? sharePaidTitle(action.mode, target) : ""}>
				{action && <SharePaidContent mode={action.mode} busy={false} error={null} onConfirm={() => setAction(null)} onCancel={() => setAction(null)} />}
			</Sheet>
		</Shell>
	);
}
