"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Avatar, Button, EmptyState, Icon, IconButton, List, ListItem, Sheet, Skeleton, Snackbar } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ExpenseList } from "@/components/expenses/expense-list";
import { clearFlash, peekFlash } from "@/components/expenses/types";
import { detectPixKeyType } from "@/lib/pix/key";
import { managedCaption } from "@/lib/ui/managed";
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

/** Visual da tela do grupo: despesas em primeiro lugar; convite e pessoas numa seção própria (ao lado em telas largas). `expenses` e `invite` entram como slots. */
export function GroupDetailView({
	group,
	invite,
	addManaged,
	expenses,
	onMemberOptions,
}: Readonly<{
	group: Group;
	invite: React.ReactNode;
	/** Ação "Adicionar pessoa sem celular" (só administradores). */
	addManaged?: React.ReactNode;
	expenses: React.ReactNode;
	onMemberOptions?: (member: Member) => void;
}>) {
	const isAdmin = group.role === "admin";
	return (
		<div className="space-y-6">
			<h1 className="break-words text-headline-medium md:text-headline-large">{group.name}</h1>

			<div className="grid items-start gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				{expenses}

				<section className="space-y-3" aria-labelledby="membros-titulo">
					<h2 id="membros-titulo" className="text-title-large">
						Pessoas do grupo
					</h2>
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
				</section>
			</div>
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
				invite={<InvitePanel groupId={group.id} groupName={group.name} isAdmin={isAdmin} />}
				addManaged={isAdmin ? <AddManagedButton onClick={() => openSheet({ kind: "add" })} /> : undefined}
				expenses={<ExpenseList groupId={group.id} />}
				onMemberOptions={(m) => openSheet({ kind: "options", uid: m.uid }, m)}
			/>
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
