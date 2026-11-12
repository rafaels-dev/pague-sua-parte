"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { Group, Member } from "@/components/groups/group-detail";
import { CarerPicker } from "@/components/groups/managed-sheet";
import { normalizeGroupDetail } from "@/components/groups/types";
import { Banner, Button, Card, EmptyState, Icon, MoneyField, SegmentedButton, Sheet, Skeleton, TextField } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { profileUrlFor } from "@/lib/ui/return-to";
import { formatDateShort, isValidISODate, todayISO } from "@/lib/ui/dates";
import { isValidDueDate } from "@/lib/ui/due-dates";
import { clampDay, createdFlash, DEFAULT_DAY, endPeriodProblem, firstDueDate } from "@/lib/ui/recurrences";
import { installmentSplitLine, monthlySplitLine, splitPreview } from "@/lib/ui/split-preview";
import { cx } from "@/lib/ui/cx";
import { payerPixNotice } from "@/lib/ui/payer-pix-notice";
import { AttachmentPicker } from "./attachment-picker";
import { PaymentChoice, type PaymentKind } from "./payment-choice";
import { normalizeExpense, setFlash, type ExpenseDetailData } from "./types";
import { splitMembersFor } from "./resplit-sheet";
import { useAttachments } from "./use-attachments";
import { modeFor, WhoSplits, type SplitMode } from "./who-splits";

export type FormErrors = Partial<Record<"amount" | "description" | "date" | "dueDate" | "installments" | "dayOfMonth" | "endPeriod" | "participants" | "files" | "form", string>>;

/** Aviso exibido no lugar do formulário quando a pessoa ainda não cadastrou a chave Pix. */
export function NoPixKeyBlock({ returnTo }: Readonly<{ returnTo?: string }> = {}) {
	return (
		<Banner
			title="Para receber, cadastre sua chave Pix"
			icon="warning"
			role="alert"
			action={
				<Button href={returnTo ? profileUrlFor(returnTo) : "/app/perfil"} size="lg" fullWidth className="md:w-auto">
					Cadastrar chave Pix
				</Button>
			}
		>
			Quem lança a despesa recebe o dinheiro dos outros. Sem a sua chave, ninguém consegue te pagar.
		</Banner>
	);
}

/** Aviso quando quem recebe é uma pessoa sem celular que ainda não tem chave Pix. */
export function ManagedNoPixKeyBlock({ groupId, uid, name }: Readonly<{ groupId: string; uid: string; name: string }>) {
	return (
		<Banner
			title={`${name} ainda não tem chave Pix`}
			icon="warning"
			role="alert"
			action={
				<Button href={`/app/grupos/${encodeURIComponent(groupId)}?editar=${encodeURIComponent(uid)}`} size="lg" fullWidth className="md:w-auto">
					Cadastrar a chave de {name}
				</Button>
			}
		>
			Quem paga a despesa recebe o dinheiro dos outros. Sem a chave de {name}, ninguém consegue pagar.
		</Banner>
	);
}

type FormMember = Pick<Member, "uid" | "name" | "picture" | "isYou"> & Partial<Pick<Member, "kind" | "youManage" | "hasPixKey">>;

export type NewExpenseFormViewProps = {
	groupId: string;
	members: FormMember[];
	/** Quem pagou: você ou uma pessoa sem celular que você cuida. */
	payerUid: string;
	/** Você administra o grupo: pode lançar a despesa em nome de qualquer pessoa do grupo. */
	isAdmin?: boolean;
	/** Você mesmo ainda não cadastrou a chave Pix. */
	selfNoPixKey?: boolean;
	onPayer: (uid: string) => void;
	amountCents: number;
	description: string;
	date: string;
	dateOpen: boolean;
	/** Como foi pago: à vista (dinheiro, cartão ou Pix) ou parcelado. */
	payment: PaymentKind;
	/** Data da próxima fatura (cartão) ou vencimento da primeira parcela (parcelado). */
	dueDate: string;
	installments: number;
	/** Despesa fixa ("Todo mês"): dia do mês. */
	dayOfMonth: number;
	/** Despesa fixa: null = sem fim; "" = vai escolher o mês; "2027-03" = mês final. */
	endPeriod: string | null;
	selected: string[];
	splitMode: SplitMode;
	errors: FormErrors;
	busy: boolean;
	/** Texto do botão enquanto envia (ex.: "Enviando anexos..."). */
	busyLabel?: string;
	attachments: React.ReactNode;
	/** Editando uma despesa que já existe: sem escolher quem pagou, sem anexos, sem parcelas/todo mês. */
	editing?: boolean;
	onAmount: (cents: number) => void;
	onDescription: (v: string) => void;
	onDate: (v: string) => void;
	onOpenDate: () => void;
	onPayment: (p: PaymentKind) => void;
	onDueDate: (v: string) => void;
	onInstallments: (n: number) => void;
	onDayOfMonth: (n: number) => void;
	onEndPeriod: (v: string | null) => void;
	onToggle: (uid: string) => void;
	onSplitMode: (m: SplitMode) => void;
	onSubmit: () => void;
};

/** Visual da tela "Lançar despesa": valor grande, descrição, data recolhida, quem divide e anexos. */
export function NewExpenseFormView(p: Readonly<NewExpenseFormViewProps>) {
	const me = p.members.find((m) => m.isYou);
	const today = todayISO();
	const payerOptions = p.members.filter((m) => m.isYou || (m.kind === "managed" && m.youManage) || (p.isAdmin && !p.editing));
	const payer = payerOptions.find((m) => m.uid === p.payerUid) ?? me;
	const payerIsManaged = !!payer && !payer.isYou;
	// Administrador lançando por alguém que ele não cuida: a falta da chave Pix só avisa, não impede.
	const notice = payer ? payerPixNotice(payer, !!p.selfNoPixKey) : "ok";
	const onlyPayer = p.selected.length === 1 && p.selected[0] === payer?.uid;
	const payerUid = payer?.uid ?? "";
	const payerName = payerIsManaged ? payer?.name : undefined;
	const monthly = p.payment === "monthly";
	const total = p.payment === "installments" ? "em cada parcela" : monthly ? "em cada mês" : "no total";
	const payerQuestion = monthly ? "Quem paga?" : "Quem pagou?";
	const preview = splitPreview(p.amountCents, p.selected, payerUid, payerName);
	const editing = !!p.editing;
	const payerChoice =
		!editing && payerOptions.length > 1 ? (
			<fieldset className="space-y-2">
				<legend className="text-title-large">{payerQuestion}</legend>
				{payerOptions.length <= 3 ? (
					<SegmentedButton
						label={payerQuestion}
						value={payer?.uid ?? ""}
						options={payerOptions.map((m) => ({ value: m.uid, label: m.isYou ? "Eu" : m.name }))}
						onChange={p.onPayer}
					/>
				) : (
					<CarerPicker label={payerQuestion} carers={payerOptions} value={payer?.uid ?? ""} onChange={p.onPayer} />
				)}
				{payerIsManaged && payer.hasPixKey !== false && <p className="text-body-large text-on-surface-variant">Você lança no nome de {payer.name}. O dinheiro vai para a chave Pix de {payer.name}.</p>}
				{notice === "warn" && payer && (
					<Banner title={`${payer.name} ainda não cadastrou a chave Pix`} icon="warning" role="status">
						As pessoas não vão conseguir pagar pelo app até ele cadastrar.
					</Banner>
				)}
			</fieldset>
		) : null;
	const blocker = editing ? null : notice === "block" && !payerIsManaged ? (
		<NoPixKeyBlock returnTo={`/app/grupos/${encodeURIComponent(p.groupId)}/despesas/nova`} />
	) : notice === "block" && payer ? (
		<ManagedNoPixKeyBlock groupId={p.groupId} uid={payer.uid} name={payer.name} />
	) : null;
	if (blocker) {
		return (
			<div className="mx-auto max-w-xl space-y-6">
				{payerChoice}
				{blocker}
			</div>
		);
	}

	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				p.onSubmit();
			}}
			className="mx-auto max-w-xl space-y-6 max-md:pb-2"
		>
			{payerChoice}
			<MoneyField id="campo-valor" label={p.payment === "installments" ? "Valor de cada parcela" : monthly ? "Valor de cada mês" : "Quanto custou?"} cents={p.amountCents} onChange={p.onAmount} error={p.errors.amount} autoFocus={payerOptions.length <= 1} />

			{editing ? (
				<EditPaymentField payment={p.payment} onPayment={p.onPayment} dueDate={p.dueDate} onDueDate={p.onDueDate} purchaseDate={p.date} error={p.errors.dueDate} />
			) : (
			<PaymentChoice
				payment={p.payment}
				onPayment={p.onPayment}
				dueDate={p.dueDate}
				onDueDate={p.onDueDate}
				installments={p.installments}
				onInstallments={p.onInstallments}
				amountCents={p.amountCents}
				purchaseDate={p.date}
				dayOfMonth={p.dayOfMonth}
				onDayOfMonth={p.onDayOfMonth}
				endPeriod={p.endPeriod}
				onEndPeriod={p.onEndPeriod}
				errors={p.errors}
			/>
			)}

			<TextField
				id="campo-descricao"
				label="O que foi?"
				value={p.description}
				onChange={(e) => p.onDescription(e.target.value)}
				maxLength={80}
				enterKeyHint="done"
				autoComplete="off"
				error={p.errors.description}
				supportingText={p.description ? undefined : "Por exemplo: Remédios da farmácia"}
			/>

			{!monthly && (
			<div>
				{p.dateOpen ? (
					<div>
						<label htmlFor="campo-data" className="mb-1 block text-title-medium text-on-surface-variant">
							Data da despesa
						</label>
						<input
							id="campo-data"
							type="date"
							value={p.date}
							max={today}
							onChange={(e) => p.onDate(e.target.value)}
							aria-invalid={p.errors.date ? true : undefined}
							className={cx(
								"h-14 w-full rounded-shape-sm border bg-transparent px-4 text-body-large text-on-surface outline-none focus:border-primary",
								p.errors.date ? "border-error" : "border-outline",
							)}
						/>
						{p.errors.date && (
							<p role="alert" className="px-1 pt-1 text-body-large text-error">
								{p.errors.date}
							</p>
						)}
					</div>
				) : (
					<Button variant="text" size="md" icon="calendar_today" onClick={p.onOpenDate} className="-ml-4">
						{formatDateShort(p.date, today)} — mudar data
					</Button>
				)}
			</div>
			)}

			<fieldset id="campo-participantes" tabIndex={-1} className="space-y-3 outline-none">
				<legend className="text-title-large">Dividir entre</legend>
				<WhoSplits
					members={p.members}
					selected={p.selected}
					mode={p.splitMode}
					onMode={p.onSplitMode}
					onToggle={p.onToggle}
					error={p.errors.participants}
					allowAlone
					payerUid={payerUid}
				/>
				{preview.kind === "ok" && !onlyPayer && (
					<Card tone="high" className="space-y-1 p-4" aria-live="polite">
						<p className="money text-title-large">{p.payment === "installments" ? installmentSplitLine(preview) : monthly ? monthlySplitLine(preview) : preview.line}</p>
						{preview.note && <p className="text-body-large text-on-surface-variant">{preview.note}</p>}
						{preview.othersCents > 0 && (
							<p className="text-body-large text-on-surface-variant">
								{payerIsManaged
									? `Os outros devem ${formatBRL(preview.othersCents)} para ${payer.name} ${total}.`
									: `Os outros te devem ${formatBRL(preview.othersCents)} ${total}.`}
							</p>
						)}
					</Card>
				)}
				{preview.kind === "error" && (
					<p role="alert" className="text-body-large text-error">
						{preview.message}
					</p>
				)}
			</fieldset>

			{!monthly && !editing && p.attachments}
			{editing && (
				<p className="text-body-large text-on-surface-variant">
					Quem já pagou continua como pago, com o comprovante. Se a parte de alguém ficar menor do que ele pagou, a diferença aparece como &ldquo;a receber de volta&rdquo;.
				</p>
			)}

			{p.errors.form && (
				<Banner tone="error" icon="error" role="alert">
					{p.errors.form}
				</Banner>
			)}

			{/* No fim do formulário, de propósito: a pessoa passa por tudo antes de lançar. */}
			<Button type="submit" fullWidth loading={p.busy} icon={p.busy ? undefined : "check"}>
				{editing ? (p.busy ? "Salvando..." : "Salvar alterações") : p.busy ? (p.busyLabel ?? (monthly ? "Criando..." : "Lançando...")) : monthly ? "Criar despesa fixa" : "Lançar despesa"}
			</Button>
		</form>
	);
}

/** Ao editar: "À vista" ou "Cartão" (com a data da próxima fatura). Parcela só muda o vencimento. */
function EditPaymentField({
	payment,
	onPayment,
	dueDate,
	onDueDate,
	purchaseDate,
	error,
}: Readonly<{ payment: PaymentKind; onPayment: (p: PaymentKind) => void; dueDate: string; onDueDate: (v: string) => void; purchaseDate: string; error?: string }>) {
	const installment = payment === "installments";
	return (
		<div className="space-y-3">
			{!installment && (
				<SegmentedButton
					label="Como foi pago"
					value={payment === "card" ? "card" : "cash"}
					options={[
						{ value: "cash", label: "À vista" },
						{ value: "card", label: "Cartão" },
					]}
					onChange={(v) => onPayment(v === "card" ? "card" : "cash")}
				/>
			)}
			{(payment === "card" || installment) && (
				<TextField
					id="campo-vencimento"
					type="date"
					floatLabel
					label={installment ? "Vencimento desta parcela" : "Data da próxima fatura"}
					value={dueDate}
					min={purchaseDate}
					onChange={(ev) => onDueDate(ev.target.value)}
					error={error}
				/>
			)}
		</div>
	);
}

export function NewExpenseSkeleton() {
	return (
		<div role="status" className="mx-auto max-w-xl space-y-6">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-24 rounded-shape-md" />
			<Skeleton className="h-14" />
			<Skeleton className="h-12 w-48 rounded-full" />
			<Skeleton className="h-32 rounded-shape-md" />
		</div>
	);
}

const FIELD_ID: Record<string, string> = {
	amount: "campo-valor",
	description: "campo-descricao",
	date: "campo-data",
	dueDate: "campo-vencimento",
	installments: "campo-parcelas",
	dayOfMonth: "campo-dia",
	endPeriod: "campo-ate",
	participants: "campo-participantes",
};
const SERVER_FIELD: Record<string, keyof FormErrors> = {
	amountCents: "amount",
	description: "description",
	date: "date",
	dueDate: "dueDate",
	installments: "installments",
	dayOfMonth: "dayOfMonth",
	endPeriod: "endPeriod",
	startPeriod: "endPeriod",
	participantUids: "participants",
	files: "files",
};

export function NewExpenseForm({ groupId, editExpenseId }: Readonly<{ groupId: string; editExpenseId?: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [group, setGroup] = useState<Group | null>(null);
	const [loadError, setLoadError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [noPixKey, setNoPixKey] = useState(false);
	const [payerUid, setPayerUid] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	// Edição: a despesa carregada (a tela só aparece para quem pode editar).
	const [editing, setEditing] = useState<ExpenseDetailData | null>(null);

	const [amountCents, setAmountCents] = useState(0);
	const [description, setDescription] = useState("");
	const [date, setDate] = useState(() => todayISO());
	const [dateOpen, setDateOpen] = useState(false);
	const [payment, setPayment] = useState<PaymentKind>("cash");
	const [dueDate, setDueDate] = useState("");
	const [installments, setInstallments] = useState(6);
	const [dayOfMonth, setDayOfMonth] = useState(DEFAULT_DAY);
	const [endPeriod, setEndPeriod] = useState<string | null>(null);
	const [selected, setSelected] = useState<string[] | null>(null);
	const [splitMode, setSplitMode] = useState<SplitMode>("all");
	const [errors, setErrors] = useState<FormErrors>({});
	const [busy, setBusy] = useState(false);
	const [confirmNoAttachment, setConfirmNoAttachment] = useState(false);
	const att = useAttachments({ enabled: !busy });
	const focusTarget = useRef<string | null>(null);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		Promise.all([
			apiFetch<Group>(`/api/groups/${encodeURIComponent(groupId)}`),
			apiFetch<{ pixKey: unknown | null }>("/api/me"),
			editExpenseId ? apiFetch<ExpenseDetailData>(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(editExpenseId)}`) : Promise.resolve(null),
		])
			.then(([g, me, ex]) => {
				if (cancelled) return;
				const detail = normalizeGroupDetail(g);
				setGroup(detail);
				setNoPixKey(!me.pixKey);
				if (ex) {
					const exp = normalizeExpense(ex);
					setEditing(exp);
					setAmountCents(exp.amountCents);
					setDescription(exp.description);
					setDate(exp.date);
					setDateOpen(true);
					setDueDate(exp.dueDate ?? "");
					setPayment(exp.installment ? "installments" : exp.dueDate ? "card" : "cash");
					setSelected(exp.participantUids);
					setSplitMode(modeFor(exp.participantUids, detail.members.map((m) => m.uid)));
					return;
				}
				setSelected((cur) => cur ?? detail.members.map((m) => m.uid));
			})
			.catch((e) => {
				if (cancelled) return;
				if (e instanceof ApiError) setLoadError({ message: e.message, notFound: e.status === 404 });
				else setLoadError({ message: "Não foi possível carregar o grupo.", notFound: false });
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId, reloadKey, editExpenseId]);

	// Depois de mostrar os erros, leva o foco ao primeiro campo com problema.
	useEffect(() => {
		const id = focusTarget.current;
		if (!id) return;
		focusTarget.current = null;
		document.getElementById(id)?.focus();
	}, [errors]);

	if (loadError) {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title={loadError.notFound ? "Grupo não encontrado" : "Ops!"}
				action={
					<>
						{!loadError.notFound && (
							<Button
								icon="refresh"
								onClick={() => {
									setLoadError(null);
									setReloadKey((k) => k + 1);
								}}
							>
								Tentar de novo
							</Button>
						)}
						<Button href="/app" variant={loadError.notFound ? "filled" : "outlined"}>
							Voltar para o início
						</Button>
					</>
				}
			>
				{loadError.notFound ? "Esse grupo não existe ou você não faz parte dele." : loadError.message}
			</EmptyState>
		);
	}
	if (!group || !selected || (editExpenseId && !editing)) return <NewExpenseSkeleton />;
	if (editing && !editing.canEdit) {
		return (
			<EmptyState tone="error" icon="error" role="alert" title="Você não pode editar" action={<Button href={`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(editing.id)}`}>Voltar para a despesa</Button>}>
				Só quem pagou a despesa ou quem administra o grupo pode editá-la.
			</EmptyState>
		);
	}
	const formMembers = editing ? splitMembersFor(editing, group.members) : group.members;
	const myUid = group.members.find((m) => m.isYou)?.uid ?? "";
	const hasManaged = group.members.some((m) => m.kind === "managed" && m.youManage);
	const isAdmin = group.role === "admin";
	const payer = editing ? editing.paidBy.uid : (payerUid ?? myUid);
	const payerIsManaged = payer !== myUid && group.members.some((m) => m.uid === payer);
	// Sem pessoas sem celular para cuidar, a falta da chave Pix troca a tela inteira; com elas, o aviso aparece no formulário.
	if (noPixKey && !hasManaged && !isAdmin && !editing) {
		return (
			<div className="mx-auto max-w-xl">
				<NoPixKeyBlock returnTo={`/app/grupos/${encodeURIComponent(groupId)}/despesas/nova`} />
			</div>
		);
	}


	function validate(): FormErrors {
		const e: FormErrors = {};
		if (amountCents <= 0) e.amount = "Digite quanto custou.";
		const desc = description.trim();
		if (!desc) e.description = "Escreva o que foi a despesa.";
		else if (desc.length > 80) e.description = "Use até 80 letras.";
		if (payment === "monthly") {
			const first = firstDueDate(todayISO(), dayOfMonth);
			const endProblem = endPeriodProblem(endPeriod, first);
			if (endProblem) e.endPeriod = endProblem;
			if (selected!.length === 0) e.participants = "Escolha pelo menos uma pessoa.";
			else if (amountCents > 0 && amountCents < selected!.length) e.participants = "O valor é pequeno demais para dividir entre tantas pessoas.";
			return e;
		}
		if (!isValidISODate(date) || date > todayISO()) e.date = "Escolha uma data válida, que não seja no futuro.";
		const needsDue = payment === "card" || payment === "installments";
		if (needsDue && !isValidDueDate(dueDate, date, todayISO())) {
			e.dueDate = dueDate ? "Escolha uma data válida, a partir do dia da compra." : payment === "card" ? "Escolha a data da próxima fatura." : "Escolha quando vence a primeira parcela.";
		}
		if (selected!.length === 0) e.participants = "Escolha pelo menos uma pessoa.";
		else if (amountCents > 0 && amountCents < selected!.length) e.participants = "O valor é pequeno demais para dividir entre tantas pessoas.";
		return e;
	}

	function showErrors(e: FormErrors) {
		setErrors(e);
		const first = (["amount", "description", "date", "dueDate", "installments", "dayOfMonth", "endPeriod", "participants"] as const).find((k) => e[k]);
		if (first === "date") setDateOpen(true);
		focusTarget.current = first ? FIELD_ID[first] : null;
		// o campo de data pode acabar de ser aberto; dá tempo de ele existir
		if (first === "date") setTimeout(() => document.getElementById("campo-data")?.focus(), 0);
	}

	/** Despesa fixa: o servidor guarda o modelo e lança a despesa de cada mês quando o mês chega. */
	async function submitMonthly() {
		setErrors({});
		setBusy(true);
		try {
			const body = {
				description: description.trim(),
				amountCents,
				dayOfMonth: clampDay(dayOfMonth),
				participantMode: splitMode === "choose" ? "selected" : splitMode,
				...(splitMode === "choose" ? { participantUids: selected } : {}),
				...(payerIsManaged ? { paidByUid: payer } : {}),
				...(endPeriod ? { endPeriod } : {}),
			};
			const created = await apiFetch<{ firstExpenseId?: string | null }>(`/api/groups/${encodeURIComponent(groupId)}/recurrences`, { method: "POST", body: JSON.stringify(body) });
			if (created?.firstExpenseId) {
				setFlash("Despesa lançada!");
				router.push(`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(created.firstExpenseId)}`);
			} else {
				setFlash(createdFlash(firstDueDate(todayISO(), dayOfMonth)));
				router.push(`/app/grupos/${encodeURIComponent(groupId)}`);
			}
		} catch (err) {
			setBusy(false);
			if (err instanceof ApiError) {
				// O servidor ainda não tem as despesas fixas: aviso calmo, tudo o que foi digitado continua.
				if (err.status === 404 || err.status === 501) return showErrors({ form: "Despesas fixas ainda não estão disponíveis. Tente de novo mais tarde." });
				if (err.status === 409 && err.field === "pixKey") {
					if (!payerIsManaged) return setNoPixKey(true);
					return setGroup((g) => (g ? { ...g, members: g.members.map((m) => (m.uid === payer ? { ...m, hasPixKey: false } : m)) } : g));
				}
				const key = err.field ? SERVER_FIELD[err.field] : undefined;
				if (key) return showErrors({ [key]: err.message });
				return showErrors({ form: err.message });
			}
			showErrors({ form: "Não foi possível criar a despesa fixa. Tente de novo." });
		}
	}

	/** Editar uma despesa que já existe: manda o estado completo dos campos editáveis. */
	async function submitEdit() {
		if (!editing) return;
		setErrors({});
		setBusy(true);
		try {
			await apiFetch(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(editing.id)}`, {
				method: "PATCH",
				body: JSON.stringify({
					description: description.trim(),
					amountCents,
					date,
					participantUids: selected,
					...(payment === "card" || payment === "installments" ? { dueDate } : {}),
				}),
			});
			setFlash("Despesa atualizada.");
			router.push(`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(editing.id)}`);
		} catch (err) {
			setBusy(false);
			if (err instanceof ApiError) {
				if (err.status === 409) return showErrors({ form: `${err.message} Volte para a despesa e abra a edição de novo.` });
				const key = err.field ? SERVER_FIELD[err.field] : undefined;
				if (key) return showErrors({ [key]: err.message });
				return showErrors({ form: err.message });
			}
			showErrors({ form: "Não foi possível salvar. Tente de novo." });
		}
	}

	async function submit(withoutAttachmentOk = false) {
		if (busy) return;
		const e = validate();
		if (Object.keys(e).length > 0) return showErrors(e);
		if (editing) return submitEdit();
		if (payment === "monthly") return submitMonthly();
		// Sem anexo, pergunta antes: o comprovante ajuda os outros a confiar na despesa.
		if (att.items.length === 0 && !withoutAttachmentOk) return setConfirmNoAttachment(true);
		setErrors({});
		setBusy(true);
		try {
			const body = new FormData();
			body.append(
				"data",
				JSON.stringify({
						description: description.trim(),
						amountCents,
						date,
						participantUids: selected,
						...(payerIsManaged ? { paidByUid: payer } : {}),
						...(payment === "card" || payment === "installments" ? { dueDate } : {}),
						...(payment === "installments" ? { installments: { count: installments } } : {}),
					}),
			);
			for (const it of att.items) body.append("files", it.file, it.file.name);
			const created = await apiFetch<{ id: string }>(`/api/groups/${encodeURIComponent(groupId)}/expenses`, { method: "POST", body });
			setFlash("Despesa lançada!");
			router.push(`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(created.id)}`);
		} catch (err) {
			// Tudo o que foi digitado continua nos campos; só mostramos o que deu errado.
			setBusy(false);
			if (err instanceof ApiError) {
				if (err.status === 409 && err.field === "pixKey") {
					if (!payerIsManaged) return setNoPixKey(true);
					// Quem recebe é a pessoa sem celular: marca que ela está sem chave para o aviso aparecer com o nome dela.
					return setGroup((g) => (g ? { ...g, members: g.members.map((m) => (m.uid === payer ? { ...m, hasPixKey: false } : m)) } : g));
				}
				const key = err.field ? SERVER_FIELD[err.field] : undefined;
				if (key) return showErrors({ [key]: err.message });
				return showErrors({ form: err.message });
			}
			showErrors({ form: "Não foi possível lançar a despesa. Tente de novo." });
		}
	}

	return (
		<>
			<NewExpenseFormView
				groupId={groupId}
				members={formMembers}
				editing={!!editing}
				isAdmin={isAdmin}
				payerUid={payer}
				selfNoPixKey={noPixKey}
				onPayer={(uid) => {
					setPayerUid(uid);
					if (splitMode === "alone") setSelected([uid]);
					setErrors({});
				}}
				amountCents={amountCents}
				description={description}
				date={date}
				dateOpen={dateOpen}
				payment={payment}
				dueDate={dueDate}
				installments={installments}
				dayOfMonth={dayOfMonth}
				endPeriod={endPeriod}
				onDayOfMonth={(n) => {
					setDayOfMonth(n);
					if (errors.dayOfMonth || errors.endPeriod) setErrors((x) => ({ ...x, dayOfMonth: undefined, endPeriod: undefined }));
				}}
				onEndPeriod={(v) => {
					setEndPeriod(v);
					if (errors.endPeriod) setErrors((x) => ({ ...x, endPeriod: undefined }));
				}}
				onPayment={(m) => {
					setPayment(m);
					setErrors((x) => ({ ...x, dueDate: undefined, installments: undefined, dayOfMonth: undefined, endPeriod: undefined }));
				}}
				onDueDate={(v) => {
					setDueDate(v);
					if (errors.dueDate) setErrors((x) => ({ ...x, dueDate: undefined }));
				}}
				onInstallments={(n) => {
					setInstallments(n);
					if (errors.installments) setErrors((x) => ({ ...x, installments: undefined }));
				}}
				selected={selected}
				splitMode={splitMode}
				errors={errors}
				busy={busy}
				busyLabel={att.items.length > 0 ? "Enviando anexos..." : "Lançando..."}
				onAmount={(c) => {
					setAmountCents(c);
					if (errors.amount) setErrors((x) => ({ ...x, amount: undefined }));
				}}
				onDescription={(v) => {
					setDescription(v);
					if (errors.description) setErrors((x) => ({ ...x, description: undefined }));
				}}
				onDate={(v) => {
					setDate(v);
					if (errors.date) setErrors((x) => ({ ...x, date: undefined }));
				}}
				onOpenDate={() => setDateOpen(true)}
				onToggle={(uid) => {
					setSelected((cur) => (cur ?? []).includes(uid) ? (cur ?? []).filter((x) => x !== uid) : [...(cur ?? []), uid]);
					if (errors.participants) setErrors((x) => ({ ...x, participants: undefined }));
				}}
				onSplitMode={(m) => {
					setSplitMode(m);
					if (m === "all") setSelected(group.members.map((x) => x.uid));
					if (m === "alone") setSelected([payer]);
					if (errors.participants) setErrors((x) => ({ ...x, participants: undefined }));
				}}
				onSubmit={() => void submit()}
				attachments={
					<AttachmentPicker
						items={att.items}
						problems={att.problems}
						serverError={errors.files}
						processing={att.processing}
						dragging={att.dragging}
						canPaste={att.canReadClipboard}
						disabled={busy}
						onPick={att.addFiles}
						onRemove={att.remove}
						onPaste={() => void att.pasteFromClipboard()}
					/>
				}
			/>
			<Sheet open={confirmNoAttachment} onClose={() => setConfirmNoAttachment(false)} title="Lançar sem anexo?">
				<div className="space-y-4">
					<p className="text-body-large text-on-surface-variant">Tem certeza que não quer colocar um anexo? A nota ou o comprovante ajuda as outras pessoas a conferir a despesa.</p>
					<div className="flex flex-col gap-3 md:flex-row-reverse">
						<Button
							fullWidth
							icon="attach_file"
							onClick={() => {
								setConfirmNoAttachment(false);
								setTimeout(() => document.getElementById("anexos-titulo")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
							}}
						>
							Colocar anexo
						</Button>
						<Button
							variant="outlined"
							fullWidth
							onClick={() => {
								setConfirmNoAttachment(false);
								void submit(true);
							}}
						>
							Lançar sem anexo
						</Button>
					</div>
				</div>
			</Sheet>
			{att.dragging && (
				<div
					aria-hidden="true"
					className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-shape-lg border-4 border-dashed border-primary bg-primary-container/30 max-md:hidden"
				>
					<p className="flex items-center gap-3 rounded-full bg-primary-container px-6 py-3 text-title-large text-on-primary-container">
						<Icon name="attach_file" /> Solte o arquivo aqui
					</p>
				</div>
			)}
		</>
	);
}
