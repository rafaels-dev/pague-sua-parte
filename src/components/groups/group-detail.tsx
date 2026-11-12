"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Avatar, Banner, Button, EmptyState, Icon, IconButton, List, ListItem, Sheet, Skeleton, Snackbar } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ExpenseList } from "@/components/expenses/expense-list";
import { clearFlash, peekFlash } from "@/components/expenses/types";
import {
	RecurrenceEditContent,
	RecurrenceEndContent,
	RecurrenceOptionsContent,
	RecurrencesDetails,
	type RecurrenceFormErrors,
	type RecurrencesState,
} from "@/components/recurrences/recurrence-list";
import { normalizeRecurrences, type Recurrence } from "@/components/recurrences/types";
import { todayISO } from "@/lib/ui/dates";
import { endPeriodProblem, firstDueDate, periodOf } from "@/lib/ui/recurrences";
import { detectPixKeyType } from "@/lib/pix/key";
import { managedCaption } from "@/lib/ui/managed";
import { GroupSummaryLive } from "@/components/home-summary";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { copyText } from "@/lib/ui/clipboard";
import { buildGroupLink, buildGroupSummaryText, normalizeGroupSummary, type GroupSummaryData } from "@/lib/ui/group-summary";
import { InvitePanel } from "./invite-panel";
import { MemberSheetContent } from "./member-sheet";
import {
	carersOf,
	ChangeCarerContent,
	ManagedFormContent,
	ManagedOptionsContent,
	type ManagedFormErrors,
} from "./managed-sheet";
import { normalizeGroupDetail, type Group, type Member } from "./types";

export type { Group, Member };

/** Botão "Adicionar pessoa sem celular" com a explicação de uma linha. */
export function AddManagedButton({ onClick }: Readonly<{ onClick: () => void }>) {
	return (
		<div className="space-y-1">
			<Button variant="tonal" icon="add" onClick={onClick} fullWidth className="md:w-auto">
				Adicionar pessoa sem celular
			</Button>
			<p className="text-body-large text-on-surface-variant">Para quem participa das despesas mas não usa o app.</p>
		</div>
	);
}

/** Visual da tela do grupo: despesas em primeiro lugar; convite e pessoas numa seção recolhida ("Pessoas do grupo"). `expenses` e `invite` entram como slots. */
export function GroupDetailView({
	group,
	invite,
	addManaged,
	summary,
	recurrences,
	expenses,
	onMemberOptions,
	onShareSummary,
}: Readonly<{
	/** Abre o sheet "Compartilhar resumo" (WhatsApp), para qualquer membro. */
	onShareSummary?: () => void;
	group: Group;
	/** Resumo do grupo logo abaixo do título (a pagar / a receber, "Pagar tudo", quem você cuida). */
	summary?: React.ReactNode;
	invite: React.ReactNode;
	/** Ação "Adicionar pessoa sem celular" (só administradores). */
	addManaged?: React.ReactNode;
	/** Linha recolhida "Despesas fixas (N)"; some sozinha quando não há nenhuma. */
	recurrences?: React.ReactNode;
	expenses: React.ReactNode;
	onMemberOptions?: (member: Member) => void;
}>) {
	const isAdmin = group.role === "admin";
	return (
		<div className="space-y-6">
			<div className="space-y-3">
				<h1 className="break-words text-headline-medium md:text-headline-large">{group.name}</h1>
				{summary}
				<Button href={`/app/grupos/${encodeURIComponent(group.id)}/relatorio`} variant="outlined" size="md" icon="bar_chart" fullWidth className="md:w-auto">
					Relatório
				</Button>
				{onShareSummary && (
					<Button onClick={onShareSummary} variant="text" size="md" icon="share" className="-ml-4 md:ml-0">
						Compartilhar resumo
					</Button>
				)}
			</div>

			{/* As pessoas ficam recolhidas: a tela é das despesas. Abre sozinho só quando ainda não há mais ninguém para dividir. */}
			<details open={group.members.length <= 1} className="group rounded-shape-md bg-surface-container-low">
				<summary className="state-layer flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-shape-md px-4 text-title-medium [&::-webkit-details-marker]:hidden">
					<Icon name="group" className="text-on-surface-variant" />
					<span className="flex-1">
						Pessoas do grupo <span className="font-normal text-on-surface-variant">({group.members.length})</span>
					</span>
					<Icon name="expand_more" className="text-on-surface-variant transition-transform group-open:rotate-180" />
				</summary>
				<div className="space-y-3 px-2 pb-3 pt-1">
					{invite}
					{addManaged}
					<List>
						{group.members.map((m) => {
							const caption = managedCaption({ kind: m.kind, youManage: m.youManage, managedByName: m.managedBy?.name });
							const notes = [caption, m.role === "admin" && "Administra o grupo", !m.hasPixKey && "Sem chave Pix"].filter(Boolean);
							const canOptions = !!onMemberOptions && (m.kind === "managed" ? m.canEdit : isAdmin && !m.isYou);
							return (
								<ListItem
									key={m.uid}
									leading={<Avatar name={m.name} src={m.picture} managed={m.kind === "managed"} />}
									headline={
										<>
											{m.name}
											{m.isYou && <span className="font-normal text-on-surface-variant"> (você)</span>}
										</>
									}
									supporting={notes.length ? notes.join(" · ") : undefined}
									trailing={
										!m.hasPixKey || canOptions ? (
											<>
												{!m.hasPixKey && <Icon name="warning" className="text-on-surface-variant" />}
												{canOptions && (
													<IconButton
														icon="more_vert"
														label={`Opções para ${m.name}`}
														onClick={() => onMemberOptions?.(m)}
														className="-mr-2"
													/>
												)}
											</>
										) : undefined
									}
								/>
							);
						})}
					</List>
				</div>
			</details>

			{recurrences}

			{expenses}
		</div>
	);
}

export function GroupDetailSkeleton() {
	return (
		<div role="status" className="space-y-6">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-10 w-2/3" />
			<Skeleton className="h-14 w-full rounded-full md:w-56" />
			<div className="space-y-3">
				<Skeleton className="h-[4.5rem] rounded-shape-md" />
				<Skeleton className="h-[4.5rem] rounded-shape-md" />
			</div>
		</div>
	);
}

type Sheet =
	| { kind: "add" }
	| { kind: "options" | "edit" | "carer"; uid: string };

type RecSheet = { kind: "options" | "edit" | "end"; id: string };

export function GroupDetail({ id }: Readonly<{ id: string }>) {
	const { user } = useAuth();
	const [group, setGroup] = useState<Group | null>(null);
	const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [sheet, setSheet] = useState<Sheet | null>(null);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	// Formulário de pessoa sem celular (adicionar / editar) e troca de responsável.
	const [name, setName] = useState("");
	const [carerUid, setCarerUid] = useState("");
	const [pixKey, setPixKey] = useState("");
	const [formErrors, setFormErrors] = useState<ManagedFormErrors>({});
	// Começa com o recado deixado pela tela anterior (ex.: "Despesa apagada."), se houver.
	const [snack, setSnack] = useState<string | null>(() => peekFlash());
	const openedFromLink = useRef(false);
	// "Compartilhar resumo": o texto do grupo inteiro, igual para qualquer membro.
	const [summary, setSummary] = useState<{ kind: "closed" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: GroupSummaryData }>({ kind: "closed" });
	const [summaryCopyFailed, setSummaryCopyFailed] = useState(false);
	// Despesas fixas: lista e o sheet de opções / edição / encerrar.
	const [recurrences, setRecurrences] = useState<RecurrencesState>({ kind: "loading" });
	const [recSheet, setRecSheet] = useState<RecSheet | null>(null);
	const [recDescription, setRecDescription] = useState("");
	const [recAmount, setRecAmount] = useState(0);
	const [recDay, setRecDay] = useState(1);
	const [recEnd, setRecEnd] = useState<string | null>(null);
	const [recErrors, setRecErrors] = useState<RecurrenceFormErrors>({});
	const [recBusy, setRecBusy] = useState(false);
	const [recEndError, setRecEndError] = useState<string | null>(null);

	useEffect(() => {
		clearFlash(); // o recado já foi lido ao criar o estado
	}, []);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<Group>(`/api/groups/${encodeURIComponent(id)}`)
			.then((g) => {
				if (cancelled) return;
				const detail = normalizeGroupDetail(g);
				setGroup(detail);
				// Vindo do "Lançar despesa" (?editar=<uid>): abre direto a edição da chave Pix dessa pessoa.
				if (openedFromLink.current) return;
				openedFromLink.current = true;
				const uid = new URLSearchParams(window.location.search).get("editar");
				const target = uid ? detail.members.find((m) => m.uid === uid && m.kind === "managed" && m.canEdit) : undefined;
				if (target) {
					setName(target.name);
					setPixKey(target.pixKey?.key ?? "");
					setSheet({ kind: "edit", uid: target.uid });
				}
			})
			.catch((e) => {
				if (cancelled) return;
				if (e instanceof ApiError) setError({ message: e.message, notFound: e.status === 404 });
				else setError({ message: "Não foi possível carregar o grupo.", notFound: false });
			});
		return () => {
			cancelled = true;
		};
	}, [user, id, reloadKey]);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<unknown>(`/api/groups/${encodeURIComponent(id)}/recurrences`)
			.then((r) => {
				if (!cancelled) setRecurrences({ kind: "ready", items: normalizeRecurrences(r) });
			})
			.catch((e) => {
				if (cancelled) return;
				// Servidor sem o recurso (404/501) ou qualquer falha: a linha simplesmente não aparece.
				void e;
				setRecurrences({ kind: "unavailable" });
			});
		return () => {
			cancelled = true;
		};
	}, [user, id, reloadKey]);

	const recSelected = recSheet && recurrences.kind === "ready" ? (recurrences.items.find((r) => r.id === recSheet.id) ?? null) : null;

	function openRecSheet(kind: RecSheet["kind"], r: Recurrence) {
		setRecDescription(r.description);
		setRecAmount(r.amountCents);
		setRecDay(r.dayOfMonth);
		setRecEnd(r.endPeriod);
		setRecErrors({});
		setRecEndError(null);
		setRecSheet({ kind, id: r.id });
	}

	function closeRecSheet() {
		if (recBusy) return;
		setRecSheet(null);
	}

	async function saveRecurrence(r: Recurrence) {
		const errors: RecurrenceFormErrors = {};
		const desc = recDescription.trim();
		if (!desc) errors.description = "Escreva o que é a despesa.";
		if (recAmount <= 0) errors.amount = "Digite o valor de cada mês.";
		const endProblem = endPeriodProblem(recEnd, r.nextDueDate || firstDueDate(todayISO(), recDay));
		if (endProblem) errors.endPeriod = endProblem;
		setRecErrors(errors);
		if (Object.keys(errors).length > 0) return;
		const patch: Record<string, unknown> = {};
		if (desc !== r.description) patch.description = desc;
		if (recAmount !== r.amountCents) patch.amountCents = recAmount;
		if (recDay !== r.dayOfMonth) patch.dayOfMonth = recDay;
		if (recEnd !== r.endPeriod) patch.endPeriod = recEnd;
		if (Object.keys(patch).length === 0) return setRecSheet(null);
		setRecBusy(true);
		try {
			await apiFetch(`/api/groups/${encodeURIComponent(id)}/recurrences/${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify(patch) });
			setRecSheet(null);
			setSnack("Salvo! Vale para os próximos meses.");
			setReloadKey((k) => k + 1);
		} catch (e) {
			if (e instanceof ApiError) {
				if (e.status === 404 || e.status === 501) setRecErrors({ form: "Despesas fixas ainda não estão disponíveis. Tente de novo mais tarde." });
				else {
					const key = { description: "description", amountCents: "amount", dayOfMonth: "dayOfMonth", endPeriod: "endPeriod" }[e.field ?? ""] as keyof RecurrenceFormErrors | undefined;
					setRecErrors({ [key ?? "form"]: e.message });
				}
			} else setRecErrors({ form: "Não foi possível salvar. Tente de novo." });
		} finally {
			setRecBusy(false);
		}
	}

	async function endRecurrence(r: Recurrence) {
		setRecBusy(true);
		setRecEndError(null);
		try {
			await apiFetch(`/api/groups/${encodeURIComponent(id)}/recurrences/${encodeURIComponent(r.id)}`, { method: "DELETE" });
			setRecSheet(null);
			setSnack("Despesa fixa encerrada.");
			setReloadKey((k) => k + 1);
		} catch (e) {
			setRecEndError(e instanceof ApiError && e.status !== 404 && e.status !== 501 ? e.message : "Não foi possível encerrar agora. Tente de novo mais tarde.");
		} finally {
			setRecBusy(false);
		}
	}

	const selected = sheet && sheet.kind !== "add" ? (group?.members.find((m) => m.uid === sheet.uid) ?? null) : null;

	function resetForm(member?: Member) {
		setName(member?.name ?? "");
		setPixKey(member?.pixKey?.key ?? "");
		setCarerUid(member?.managedBy?.uid ?? group?.members.find((m) => m.isYou)?.uid ?? "");
		setFormErrors({});
		setActionError(null);
	}

	function openSheet(next: Sheet, member?: Member) {
		resetForm(member);
		setConfirmingRemove(false);
		setSheet(next);
	}

	function closeSheet() {
		if (busy) return;
		setSheet(null);
		setConfirmingRemove(false);
		setActionError(null);
		setFormErrors({});
	}

	async function run(request: () => Promise<unknown>, message: string) {
		setBusy(true);
		setActionError(null);
		try {
			await request();
			setSheet(null);
			setConfirmingRemove(false);
			setSnack(message);
			setReloadKey((k) => k + 1);
		} catch (e) {
			setActionError(e instanceof ApiError ? e.message : "Não foi possível concluir. Tente de novo.");
		} finally {
			setBusy(false);
		}
	}

	/** Valida a chave Pix como no perfil; devolve a mensagem de erro ou null. */
	function pixProblem(): string | null {
		return pixKey.trim() && !detectPixKeyType(pixKey) ? "Chave Pix inválida. Confira o número ou e-mail digitado." : null;
	}

	async function submitManaged(mode: "add" | "edit") {
		const errors: ManagedFormErrors = {};
		if (!name.trim()) errors.name = "Escreva o nome da pessoa.";
		const pixErr = pixProblem();
		if (pixErr) errors.pixKey = pixErr;
		if (mode === "add" && !carerUid) errors.managedBy = "Escolha quem vai cuidar.";
		setFormErrors(errors);
		if (Object.keys(errors).length > 0) return;
		setBusy(true);
		try {
			const base = `/api/groups/${encodeURIComponent(id)}/managed-members`;
			if (mode === "add") {
				const body: Record<string, unknown> = { name: name.trim(), managedBy: carerUid };
				if (pixKey.trim()) body.pixKey = pixKey.trim();
				await apiFetch(base, { method: "POST", body: JSON.stringify(body) });
				setSnack(`${name.trim()} foi adicionado ao grupo.`);
			} else if (selected) {
				await apiFetch(`${base}/${encodeURIComponent(selected.uid)}`, {
					method: "PATCH",
					body: JSON.stringify({ name: name.trim(), pixKey: pixKey.trim() ? pixKey.trim() : null }),
				});
				setSnack("Salvo!");
			}
			setSheet(null);
			setReloadKey((k) => k + 1);
		} catch (e) {
			const msg = e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo.";
			const field = e instanceof ApiError ? e.field : undefined;
			if (field === "name" || field === "managedBy" || field === "pixKey") setFormErrors({ [field]: msg });
			else setFormErrors({ form: msg });
		} finally {
			setBusy(false);
		}
	}

	function openSummary() {
		setSummary({ kind: "loading" });
		setSummaryCopyFailed(false);
		apiFetch<unknown>(`/api/groups/${encodeURIComponent(id)}/summary`)
			.then((d) => setSummary({ kind: "ready", data: normalizeGroupSummary(d) }))
			.catch((e) => setSummary({ kind: "error", message: e instanceof ApiError ? e.message : "Não foi possível montar o resumo. Tente de novo." }));
	}
	const summaryText = summary.kind === "ready" && group ? buildGroupSummaryText(summary.data, buildGroupLink(window.location.origin, group.id)) : "";

	const memberUrl = (m: Member) => `/api/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(m.uid)}`;

	if (error) {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title={error.notFound ? "Grupo não encontrado" : "Ops!"}
				action={
					<>
						{!error.notFound && (
							<Button
								icon="refresh"
								onClick={() => {
									setError(null);
									setReloadKey((k) => k + 1);
								}}
							>
								Tentar de novo
							</Button>
						)}
						<Button href="/app" variant={error.notFound ? "filled" : "outlined"}>
							Voltar para o início
						</Button>
					</>
				}
			>
				{error.notFound ? "Esse grupo não existe ou você não faz parte dele." : error.message}
			</EmptyState>
		);
	}

	if (!group) return <GroupDetailSkeleton />;

	const isAdmin = group.role === "admin";
	return (
		<>
			<GroupDetailView
				group={group}
				summary={<GroupSummaryLive groupId={group.id} />}
				invite={<InvitePanel groupId={group.id} groupName={group.name} isAdmin={isAdmin} />}
				addManaged={isAdmin ? <AddManagedButton onClick={() => openSheet({ kind: "add" })} /> : undefined}
				recurrences={<RecurrencesDetails state={recurrences} onOptions={(r) => openRecSheet("options", r)} />}
				expenses={<ExpenseList groupId={group.id} />}
				onMemberOptions={(m) => openSheet({ kind: "options", uid: m.uid }, m)}
				onShareSummary={openSummary}
			/>
			<Sheet open={summary.kind !== "closed"} onClose={() => setSummary({ kind: "closed" })} title="Compartilhar resumo">
				{summary.kind === "loading" && (
					<p role="status" className="py-8 text-center text-body-large text-on-surface-variant">
						Montando o resumo...
					</p>
				)}
				{summary.kind === "error" && (
					<div className="space-y-4">
						<Banner tone="error" icon="error" role="alert">
							{summary.message}
						</Banner>
						<Button icon="refresh" fullWidth onClick={openSummary}>
							Tentar de novo
						</Button>
					</div>
				)}
				{summary.kind === "ready" && (
					<div className="space-y-4">
						<ShareExpenseContent
							text={summaryText}
							intro="Mande o resumo para o grupo ver quem deve a quem. É o mesmo para todo mundo."
							canShare={typeof navigator !== "undefined" && typeof navigator.share === "function"}
							copyFailed={summaryCopyFailed}
							dismissLabel="Fechar"
							whatsappLabel="Compartilhar no WhatsApp"
							preview
							onCopy={() =>
								void copyText(summaryText).then((ok) => {
									setSummaryCopyFailed(!ok);
									if (ok) setSnack("Mensagem copiada!");
								})
							}
							onShare={() => {
								void navigator.share({ text: summaryText }).catch(() => {});
							}}
							onClose={() => setSummary({ kind: "closed" })}
						/>
					</div>
				)}
			</Sheet>
			<Sheet
				open={!!recSelected}
				onClose={closeRecSheet}
				title={recSheet?.kind === "edit" ? "Mudar despesa fixa" : recSheet?.kind === "end" ? "Encerrar despesa fixa?" : (recSelected?.description ?? "")}
			>
				{recSelected && recSheet?.kind === "options" && (
					<RecurrenceOptionsContent recurrence={recSelected} onEdit={() => openRecSheet("edit", recSelected)} onEnd={() => openRecSheet("end", recSelected)} />
				)}
				{recSelected && recSheet?.kind === "edit" && (
					<RecurrenceEditContent
						description={recDescription}
						amountCents={recAmount}
						dayOfMonth={recDay}
						endPeriod={recEnd}
						minEnd={periodOf(recSelected.nextDueDate || firstDueDate(todayISO(), recDay))}
						errors={recErrors}
						busy={recBusy}
						onDescription={(v) => {
							setRecDescription(v);
							setRecErrors((e) => ({ ...e, description: undefined }));
						}}
						onAmount={(c) => {
							setRecAmount(c);
							setRecErrors((e) => ({ ...e, amount: undefined }));
						}}
						onDay={(n) => {
							setRecDay(n);
							setRecErrors((e) => ({ ...e, dayOfMonth: undefined }));
						}}
						onEndPeriod={(v) => {
							setRecEnd(v);
							setRecErrors((e) => ({ ...e, endPeriod: undefined }));
						}}
						onSubmit={() => void saveRecurrence(recSelected)}
						onCancel={() => openRecSheet("options", recSelected)}
					/>
				)}
				{recSelected && recSheet?.kind === "end" && (
					<RecurrenceEndContent
						recurrence={recSelected}
						busy={recBusy}
						error={recEndError}
						onConfirm={() => void endRecurrence(recSelected)}
						onCancel={() => openRecSheet("options", recSelected)}
					/>
				)}
			</Sheet>
			<Sheet
				open={sheet !== null && (sheet.kind === "add" || !!selected)}
				onClose={closeSheet}
				title={
					sheet?.kind === "add"
						? "Adicionar pessoa sem celular"
						: sheet?.kind === "edit"
							? `Editar ${selected?.name ?? ""}`
							: sheet?.kind === "carer"
								? "Trocar responsável"
								: (selected?.name ?? "")
				}
			>
				{sheet?.kind === "add" && (
					<ManagedFormContent
						mode="add"
						name={name}
						carerUid={carerUid}
						pixKey={pixKey}
						carers={carersOf(group.members)}
						errors={formErrors}
						busy={busy}
						onName={(v) => {
							setName(v);
							setFormErrors((e) => ({ ...e, name: undefined }));
						}}
						onCarer={(uid) => {
							setCarerUid(uid);
							setFormErrors((e) => ({ ...e, managedBy: undefined }));
						}}
						onPixKey={(v) => {
							setPixKey(v);
							setFormErrors((e) => ({ ...e, pixKey: undefined }));
						}}
						onSubmit={() => void submitManaged("add")}
						onCancel={closeSheet}
					/>
				)}
				{sheet?.kind === "edit" && selected && (
					<ManagedFormContent
						mode="edit"
						name={name}
						carerUid={carerUid}
						pixKey={pixKey}
						carers={[]}
						errors={formErrors}
						busy={busy}
						onName={(v) => {
							setName(v);
							setFormErrors((e) => ({ ...e, name: undefined }));
						}}
						onCarer={setCarerUid}
						onPixKey={(v) => {
							setPixKey(v);
							setFormErrors((e) => ({ ...e, pixKey: undefined }));
						}}
						onSubmit={() => void submitManaged("edit")}
						onCancel={() => openSheet({ kind: "options", uid: selected.uid }, selected)}
					/>
				)}
				{sheet?.kind === "carer" && selected && (
					<ChangeCarerContent
						name={selected.name}
						carers={carersOf(group.members)}
						value={carerUid}
						busy={busy}
						error={actionError}
						unchanged={carerUid === selected.managedBy?.uid}
						onChange={setCarerUid}
						onSubmit={() => {
							const who = carersOf(group.members).find((m) => m.uid === carerUid);
							void run(
								() =>
									apiFetch(`/api/groups/${encodeURIComponent(id)}/managed-members/${encodeURIComponent(selected.uid)}`, {
										method: "PATCH",
										body: JSON.stringify({ managedBy: carerUid }),
									}),
								`${who?.isYou ? "Agora você cuida" : `${who?.name ?? "Outra pessoa"} agora cuida`} de ${selected.name}.`,
							);
						}}
						onCancel={() => openSheet({ kind: "options", uid: selected.uid }, selected)}
					/>
				)}
				{sheet?.kind === "options" &&
					selected &&
					(selected.kind === "managed" ? (
						<ManagedOptionsContent
							member={selected}
							isAdmin={isAdmin}
							busy={busy}
							error={actionError}
							confirmingRemove={confirmingRemove}
							onEdit={() => openSheet({ kind: "edit", uid: selected.uid }, selected)}
							onChangeCarer={() => openSheet({ kind: "carer", uid: selected.uid }, selected)}
							onAskRemove={() => setConfirmingRemove(true)}
							onCancelRemove={() => setConfirmingRemove(false)}
							onConfirmRemove={() => void run(() => apiFetch(memberUrl(selected), { method: "DELETE" }), `${selected.name} saiu do grupo.`)}
						/>
					) : (
						<MemberSheetContent
							member={selected}
							busy={busy}
							error={actionError}
							confirmingRemove={confirmingRemove}
							onToggleRole={() => {
								const promote = selected.role !== "admin";
								void run(
									() => apiFetch(memberUrl(selected), { method: "PATCH", body: JSON.stringify({ role: promote ? "admin" : "member" }) }),
									promote ? `${selected.name} agora administra o grupo.` : `${selected.name} não administra mais o grupo.`,
								);
							}}
							onAskRemove={() => setConfirmingRemove(true)}
							onCancelRemove={() => setConfirmingRemove(false)}
							onConfirmRemove={() => void run(() => apiFetch(memberUrl(selected), { method: "DELETE" }), `${selected.name} saiu do grupo.`)}
						/>
					))}
			</Sheet>
			<Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} aboveNav />
		</>
	);
}
