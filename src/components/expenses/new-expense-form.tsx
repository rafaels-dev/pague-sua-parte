"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { Group, Member } from "@/components/groups/group-detail";
import { Banner, Button, Card, EmptyState, Icon, MoneyField, Skeleton, TextField } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatDateShort, isValidISODate, todayISO } from "@/lib/ui/dates";
import { splitPreview } from "@/lib/ui/split-preview";
import { cx } from "@/lib/ui/cx";
import { AttachmentPicker } from "./attachment-picker";
import { setFlash } from "./types";
import { useAttachments } from "./use-attachments";
import { WhoSplits, type SplitMode } from "./who-splits";

export type FormErrors = Partial<Record<"amount" | "description" | "date" | "participants" | "files" | "form", string>>;

/** Aviso exibido no lugar do formulário quando a pessoa ainda não cadastrou a chave Pix. */
export function NoPixKeyBlock() {
	return (
		<Banner
			title="Para receber, cadastre sua chave Pix"
			icon="warning"
			role="alert"
			action={
				<Button href="/app/perfil" size="lg" fullWidth className="md:w-auto">
					Cadastrar chave Pix
				</Button>
			}
		>
			Quem lança a despesa recebe o dinheiro dos outros. Sem a sua chave, ninguém consegue te pagar.
		</Banner>
	);
}

export type NewExpenseFormViewProps = {
	members: Pick<Member, "uid" | "name" | "picture" | "isYou">[];
	amountCents: number;
	description: string;
	date: string;
	dateOpen: boolean;
	selected: string[];
	splitMode: SplitMode;
	errors: FormErrors;
	busy: boolean;
	/** Texto do botão enquanto envia (ex.: "Enviando anexos..."). */
	busyLabel?: string;
	attachments: React.ReactNode;
	onAmount: (cents: number) => void;
	onDescription: (v: string) => void;
	onDate: (v: string) => void;
	onOpenDate: () => void;
	onToggle: (uid: string) => void;
	onSplitMode: (m: SplitMode) => void;
	onSubmit: () => void;
};

/** Visual da tela "Lançar despesa": valor grande, descrição, data recolhida, quem divide e anexos. */
export function NewExpenseFormView(p: Readonly<NewExpenseFormViewProps>) {
	const me = p.members.find((m) => m.isYou);
	const today = todayISO();
	const onlyMe = p.selected.length === 1 && p.selected[0] === me?.uid;
	const preview = useMemo(
		() => splitPreview(p.amountCents, p.selected, me?.uid ?? ""),
		[p.amountCents, p.selected, me?.uid],
	);

	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				p.onSubmit();
			}}
			className="mx-auto max-w-xl space-y-6 max-md:pb-2"
		>
			<MoneyField id="campo-valor" label="Quanto custou?" cents={p.amountCents} onChange={p.onAmount} error={p.errors.amount} autoFocus />

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

			<fieldset id="campo-participantes" tabIndex={-1} className="space-y-3 outline-none">
				<legend className="text-title-large">Dividir entre</legend>
				<WhoSplits
					members={p.members}
					selected={p.selected}
					mode={p.splitMode}
					onMode={p.onSplitMode}
					onToggle={p.onToggle}
					error={p.errors.participants}
				/>
				{preview.kind === "ok" && !onlyMe && (
					<Card tone="high" className="space-y-1 p-4" aria-live="polite">
						<p className="money text-title-large">{preview.line}</p>
						{preview.note && <p className="text-body-large text-on-surface-variant">{preview.note}</p>}
						{preview.othersCents > 0 && (
							<p className="text-body-large text-on-surface-variant">
								Os outros te devem {formatBRL(preview.othersCents)} no total.
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

			{p.attachments}

			{p.errors.form && (
				<Banner tone="error" icon="error" role="alert">
					{p.errors.form}
				</Banner>
			)}

			{/* Celular: barra colada acima da navegação inferior, sempre à vista. Telas largas: botão comum no fim. */}
			<div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-outline-variant bg-surface px-4 pb-3 pt-3 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
				<Button type="submit" fullWidth loading={p.busy} icon={p.busy ? undefined : "check"}>
					{p.busy ? (p.busyLabel ?? "Lançando...") : "Lançar despesa"}
				</Button>
			</div>
		</form>
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
	participants: "campo-participantes",
};
const SERVER_FIELD: Record<string, keyof FormErrors> = {
	amountCents: "amount",
	description: "description",
	date: "date",
	participantUids: "participants",
	files: "files",
};

export function NewExpenseForm({ groupId }: Readonly<{ groupId: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [group, setGroup] = useState<Group | null>(null);
	const [loadError, setLoadError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [noPixKey, setNoPixKey] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);

	const [amountCents, setAmountCents] = useState(0);
	const [description, setDescription] = useState("");
	const [date, setDate] = useState(() => todayISO());
	const [dateOpen, setDateOpen] = useState(false);
	const [selected, setSelected] = useState<string[] | null>(null);
	const [splitMode, setSplitMode] = useState<SplitMode>("all");
	const [errors, setErrors] = useState<FormErrors>({});
	const [busy, setBusy] = useState(false);
	const att = useAttachments({ enabled: !busy });
	const focusTarget = useRef<string | null>(null);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		Promise.all([apiFetch<Group>(`/api/groups/${encodeURIComponent(groupId)}`), apiFetch<{ pixKey: unknown | null }>("/api/me")])
			.then(([g, me]) => {
				if (cancelled) return;
				setGroup(g);
				setNoPixKey(!me.pixKey);
				setSelected((cur) => cur ?? g.members.map((m) => m.uid));
			})
			.catch((e) => {
				if (cancelled) return;
				if (e instanceof ApiError) setLoadError({ message: e.message, notFound: e.status === 404 });
				else setLoadError({ message: "Não foi possível carregar o grupo.", notFound: false });
			});
		return () => {
			cancelled = true;
		};
	}, [user, groupId, reloadKey]);

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
	if (!group || !selected) return <NewExpenseSkeleton />;
	if (noPixKey) {
		return (
			<div className="mx-auto max-w-xl">
				<NoPixKeyBlock />
			</div>
		);
	}


	function validate(): FormErrors {
		const e: FormErrors = {};
		if (amountCents <= 0) e.amount = "Digite quanto custou.";
		const desc = description.trim();
		if (!desc) e.description = "Escreva o que foi a despesa.";
		else if (desc.length > 80) e.description = "Use até 80 letras.";
		if (!isValidISODate(date) || date > todayISO()) e.date = "Escolha uma data válida, que não seja no futuro.";
		if (selected!.length === 0) e.participants = "Escolha pelo menos uma pessoa.";
		else if (amountCents > 0 && amountCents < selected!.length) e.participants = "O valor é pequeno demais para dividir entre tantas pessoas.";
		return e;
	}

	function showErrors(e: FormErrors) {
		setErrors(e);
		const first = (["amount", "description", "date", "participants"] as const).find((k) => e[k]);
		if (first === "date") setDateOpen(true);
		focusTarget.current = first ? FIELD_ID[first] : null;
		// o campo de data pode acabar de ser aberto; dá tempo de ele existir
		if (first === "date") setTimeout(() => document.getElementById("campo-data")?.focus(), 0);
	}

	async function submit() {
		if (busy) return;
		const e = validate();
		if (Object.keys(e).length > 0) return showErrors(e);
		setErrors({});
		setBusy(true);
		try {
			const body = new FormData();
			body.append(
				"data",
				JSON.stringify({ description: description.trim(), amountCents, date, participantUids: selected }),
			);
			for (const it of att.items) body.append("files", it.file, it.file.name);
			const created = await apiFetch<{ id: string }>(`/api/groups/${encodeURIComponent(groupId)}/expenses`, { method: "POST", body });
			setFlash("Despesa lançada!");
			router.push(`/app/grupos/${encodeURIComponent(groupId)}/despesas/${encodeURIComponent(created.id)}`);
		} catch (err) {
			// Tudo o que foi digitado continua nos campos; só mostramos o que deu errado.
			setBusy(false);
			if (err instanceof ApiError) {
				if (err.status === 409 && err.field === "pixKey") return setNoPixKey(true);
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
				members={group.members}
				amountCents={amountCents}
				description={description}
				date={date}
				dateOpen={dateOpen}
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
