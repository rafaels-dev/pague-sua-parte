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
import { AddManagedButton, GroupDetailView, type Group } from "@/components/groups/group-detail";
import { carersOf, ChangeCarerContent, ManagedFormContent, ManagedOptionsContent } from "@/components/groups/managed-sheet";
import { normalizeMember, type Member } from "@/components/groups/types";
import { ManagedSummaryCards } from "@/components/home-summary";
import { Button, Sheet } from "@/components/ui";
import { todayISO } from "@/lib/ui/dates";

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
type SumInput = Omit<ExpenseSummary, "yourDueCents" | "yourRefundCents" | "refundCount" | "managed" | "ownerView" | "paidBy"> &
	Partial<Pick<ExpenseSummary, "yourDueCents" | "yourRefundCents" | "refundCount" | "managed" | "ownerView">> & {
		paidBy: { uid: string; name: string; isYou: boolean; youManage?: boolean };
	};
const sum = (o: SumInput): ExpenseSummary => ({
	yourDueCents: o.yourStatus === "pending" ? o.yourShareCents : 0,
	yourRefundCents: 0,
	refundCount: 0,
	managed: [],
	ownerView: null,
	...o,
	paidBy: { ...o.paidBy, youManage: o.paidBy.youManage ?? false },
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

function Shell({ pathname, children, framed, user = USER }: Readonly<{ pathname: string; children: React.ReactNode; framed: boolean; user?: typeof USER }>) {
	return (
		<AppShellView pathname={pathname} user={user} onSignOut={noop} className={framed ? "min-h-0!" : undefined}>
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

export function MockGroup({ empty = false, framed = true, care = false }: Readonly<{ empty?: boolean; framed?: boolean; care?: boolean }>) {
	const group = care ? CARE_GROUP : MOCK_GROUP;
	return (
		<Shell pathname="/app/grupos/1" framed={framed} user={care ? CARE_USER : USER}>
			<GroupDetailView
				group={group}
				onMemberOptions={noop}
				invite={
					<Button icon="share" fullWidth className="md:w-auto">
						Convidar pessoas
					</Button>
				}
				addManaged={care ? <AddManagedButton onClick={noop} /> : undefined}
				expenses={<ExpenseListView groupId="1" state={{ kind: "ready", expenses: empty ? [] : care ? CARE_EXPENSES : EXPENSES }} />}
			/>
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
	care = false,
	payer,
}: Readonly<{
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
	const list = care ? CARE_GROUP.members : members;
	const who = useWhoSplits(list.map((m) => m.uid));
	const [payerUid, setPayerUid] = useState(payer ?? list.find((m) => m.isYou)?.uid ?? "");
	const [started, setStarted] = useState(false);
	if (!started && choose) {
		setStarted(true);
		who.setMode("choose");
		for (const uid of list.map((m) => m.uid)) if (!choose.includes(uid)) who.toggle(uid);
	}
	const att = useAttachments();
	return (
		<Shell pathname="/app/grupos/1/despesas/nova" framed={framed} user={care ? CARE_USER : USER}>
			<NewExpenseFormView
				groupId="1"
				members={list}
				payerUid={payerUid}
				onPayer={setPayerUid}
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

export type MockMode = "debtor" | "payer" | "partial" | "refund" | "owner-return" | "recalc" | "two-parts" | "care-paid";
const isCare = (mode: MockMode) => mode === "two-parts" || mode === "care-paid";

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
	kind: "user",
	youManage: false,
	managedByName: null,
	...s,
});
const PAID_AT = daysAgo(1) + "T15:00:00.000Z";
const A = { uid: "a", name: "Rafael Schettino" };
const B = { uid: "b", name: "Maria das Dores Silva" };

/** Despesas do cenário da Renata (que cuida do avô Benjamim). */
function careDetail(mode: "two-parts" | "care-paid"): ExpenseDetailData {
	const R = { uid: "a", name: "Renata Souza" };
	const BEN = { uid: "m1", name: "Benjamim", kind: "managed" as const, managedByName: "Renata Souza", youManage: true };
	const common = { groupId: "1", createdAt: new Date().toISOString(), attachments: [] as ExpenseDetailData["attachments"] };
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

function detail(mode: MockMode): ExpenseDetailData {
	if (isCare(mode)) return careDetail(mode as "two-parts" | "care-paid");
	const youOwner = mode === "payer" || mode === "owner-return" || mode === "recalc";
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
	const [qrOpen, setQrOpen] = useState<string | null>(qrInitial ? "a" : null);
	const [action, setAction] = useState(confirm ?? null);
	const [shareOpen, setShareOpen] = useState(shareSheet);
	const [resplitOpen, setResplitOpen] = useState(!!resplit);
	const expense = detail(mode);
	const members = (isCare(mode) ? CARE_GROUP : MOCK_GROUP).members.map(({ uid, name, picture, isYou, kind }) => ({ uid, name, picture, isYou, kind }));
	const who = useWhoSplits(members.map((m) => m.uid), resplit ?? expense.participantUids);
	const target = action ? expense.shares.find((s) => s.uid === action.uid) : undefined;
	const text = buildExpenseShareText(expense, "https://pague-sua-parte.app/app/grupos/1/despesas/e1");
	return (
		<Shell pathname="/app/grupos/1/despesas/e1" framed={framed} user={isCare(mode) ? CARE_USER : USER}>
			<ExpenseDetailView
				expense={expense}
				attachments={isCare(mode) ? [] : ATTACHMENTS}
				qrOpen={qrOpen}
				codeFallback={codeFallback ? "a" : null}
				onToggleQr={(uid) => setQrOpen((o) => (o === uid ? null : uid))}
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
export function MockHome({
	framed = true,
	chooser = false,
	groups = MOCK_GROUPS,
	managed = [],
}: Readonly<{ framed?: boolean; chooser?: boolean; groups?: GroupSummary[]; managed?: React.ComponentProps<typeof ManagedSummaryCards>["managed"] }>) {
	const [open, setOpen] = useState(chooser);
	return (
		<Shell pathname="/app" framed={framed} user={managed.length > 0 ? CARE_USER : USER}>
			<div className="space-y-6">
				<h1 className="text-headline-medium md:text-headline-large">Olá, {managed.length > 0 ? "Renata" : "Rafael"}!</h1>
				<div className="space-y-3">
					<HomeSummary receiveCents={47350} payCents={132590} />
					<ManagedSummaryCards managed={managed} />
				</div>
				<GroupsListView state={{ kind: "ready", groups }} onPostExpense={() => setOpen(true)} />
				<ChooseGroupSheet open={open} onClose={() => setOpen(false)} groups={groups} />
			</div>
		</Shell>
	);
}
