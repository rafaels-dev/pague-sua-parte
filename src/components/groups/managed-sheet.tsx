import { Avatar, Banner, Button, TextField } from "@/components/ui";
import { PixKeyChoice } from "@/components/pix-key-choice";
import { PIX_KEY_LABELS, detectPixKeyType, type AmbiguousKeyChoice } from "@/lib/pix/key";
import { cx } from "@/lib/ui/cx";
import { managedCaption } from "@/lib/ui/managed";
import type { Member } from "./types";

export type ManagedFormErrors = Partial<Record<"name" | "managedBy" | "pixKey" | "form", string>>;

/** Quem pode ser responsável: só pessoas com celular (conta própria). */
export function carersOf(members: Member[]): Member[] {
	return members.filter((m) => m.kind === "user");
}

/** Texto de apoio do campo Pix: tipo detectado ao vivo, aviso de chave inválida ou a dica padrão. */
function pixSupport(value: string) {
	const detected = value.trim() ? detectPixKeyType(value) : null;
	if (detected) return <span className="font-medium text-primary">Tipo da chave: {PIX_KEY_LABELS[detected]}</span>;
	if (value.trim()) return "Ainda não parece uma chave Pix válida.";
	return "Opcional. Sem a chave, ninguém consegue pagar essa pessoa.";
}

/** Escolha de uma pessoa (o responsável): linhas grandes, uma marcada. */
export function CarerPicker({
	label,
	carers,
	value,
	onChange,
	error,
}: Readonly<{ label: string; carers: Pick<Member, "uid" | "name" | "picture" | "isYou">[]; value: string; onChange: (uid: string) => void; error?: string }>) {
	return (
		<div role="radiogroup" aria-label={label} className="space-y-2">
			{carers.map((m) => {
				const selected = m.uid === value;
				return (
					<button
						key={m.uid}
						type="button"
						role="radio"
						aria-checked={selected}
						onClick={() => onChange(m.uid)}
						className={cx(
							"state-layer flex min-h-14 w-full items-center gap-3 rounded-shape-md border px-3 text-left text-body-large",
							selected ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline text-on-surface",
						)}
					>
						<Avatar name={m.name} src={m.picture} size="sm" />
						<span className="min-w-0 flex-1 break-words font-medium">
							{m.name}
							{m.isYou && <span className="font-normal"> (você)</span>}
						</span>
						<span
							aria-hidden="true"
							className={cx(
								"flex size-6 shrink-0 items-center justify-center rounded-full border-2",
								selected ? "border-on-secondary-container" : "border-outline",
							)}
						>
							{selected && <span className="size-3 rounded-full bg-on-secondary-container" />}
						</span>
					</button>
				);
			})}
			{error && (
				<p role="alert" className="text-body-large text-error">
					{error}
				</p>
			)}
		</div>
	);
}

/** Formulário (visual) de adicionar ou editar uma pessoa sem celular. Em "edit" só nome e chave Pix. */
export function ManagedFormContent({
	mode,
	name,
	carerUid,
	pixKey,
	carers,
	errors,
	busy,
	onName,
	onCarer,
	onPixKey,
	ambiguous = false,
	keyChoice = null,
	onKeyChoice,
	onSubmit,
	onCancel,
}: Readonly<{
	mode: "add" | "edit";
	name: string;
	carerUid: string;
	pixKey: string;
	carers: Member[];
	errors: ManagedFormErrors;
	busy: boolean;
	onName: (v: string) => void;
	onCarer: (uid: string) => void;
	onPixKey: (v: string) => void;
	/** O número pode ser CPF ou celular: pede a escolha. */
	ambiguous?: boolean;
	keyChoice?: AmbiguousKeyChoice | null;
	onKeyChoice?: (v: AmbiguousKeyChoice) => void;
	onSubmit: () => void;
	onCancel: () => void;
}>) {
	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
			className="space-y-5"
		>
			{mode === "add" && (
				<p className="text-body-large text-on-surface-variant">Para quem participa das despesas mas não usa o app. Quem cuida age no nome dessa pessoa.</p>
			)}
			<TextField
				label="Nome"
				name="name"
				autoComplete="off"
				maxLength={60}
				value={name}
				error={errors.name}
				onChange={(e) => onName(e.target.value)}
				className="[--field-bg:var(--md-surface-container-low)]"
			/>
			{mode === "add" && (
				<div className="space-y-2">
					<p className="text-title-medium">Quem cuida?</p>
					<CarerPicker label="Quem cuida?" carers={carers} value={carerUid} onChange={onCarer} error={errors.managedBy} />
				</div>
			)}
			<TextField
				label="Chave Pix (opcional)"
				name="pixKey"
				autoComplete="off"
				autoCapitalize="none"
				spellCheck={false}
				placeholder="CPF, e-mail, celular ou chave aleatória"
				value={pixKey}
				error={errors.pixKey}
				supportingText={pixSupport(pixKey)}
				onChange={(e) => onPixKey(e.target.value)}
				className="[--field-bg:var(--md-surface-container-low)]"
			/>
			{ambiguous && onKeyChoice && <PixKeyChoice value={keyChoice} onChange={onKeyChoice} />}
			{errors.form && (
				<Banner tone="error" icon="error" role="alert">
					{errors.form}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button type="submit" loading={busy} fullWidth icon={busy ? undefined : "check"}>
					{busy ? "Salvando..." : mode === "add" ? "Adicionar" : "Salvar"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Cancelar
				</Button>
			</div>
		</form>
	);
}

/** Opções (visual) de uma pessoa sem celular: editar, trocar o responsável e, para admins, remover. */
export function ManagedOptionsContent({
	member,
	isAdmin,
	busy,
	error,
	confirmingRemove,
	onEdit,
	onChangeCarer,
	onAskRemove,
	onCancelRemove,
	onConfirmRemove,
}: Readonly<{
	member: Pick<Member, "name" | "kind" | "youManage" | "managedBy" | "hasPixKey">;
	isAdmin: boolean;
	busy: boolean;
	error: string | null;
	confirmingRemove: boolean;
	onEdit: () => void;
	onChangeCarer: () => void;
	onAskRemove: () => void;
	onCancelRemove: () => void;
	onConfirmRemove: () => void;
}>) {
	const errorBanner = error && (
		<Banner tone="error" icon="error" role="alert">
			{error}
		</Banner>
	);

	if (confirmingRemove) {
		return (
			<div className="space-y-4">
				<p className="text-body-large text-on-surface">Remover {member.name} do grupo? A pessoa deixa de participar das próximas despesas.</p>
				{errorBanner}
				<div className="flex flex-col gap-3">
					<Button onClick={onConfirmRemove} loading={busy} fullWidth className="bg-error! text-on-error!">
						{busy ? "Removendo..." : "Sim, remover"}
					</Button>
					<Button variant="outlined" onClick={onCancelRemove} disabled={busy} fullWidth>
						Cancelar
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">
				{[managedCaption({ ...member, managedByName: member.managedBy?.name }), member.hasPixKey ? null : "Ainda não tem chave Pix."].filter(Boolean).join(". ")}
			</p>
			{errorBanner}
			<div className="flex flex-col gap-3">
				<Button variant="tonal" icon="person" onClick={onEdit} disabled={busy} fullWidth>
					Editar nome e chave Pix
				</Button>
				<Button variant="tonal" icon="group" onClick={onChangeCarer} disabled={busy} fullWidth>
					Trocar responsável
				</Button>
				{isAdmin && (
					<Button variant="text" icon="logout" onClick={onAskRemove} disabled={busy} fullWidth className="text-error!">
						Remover do grupo
					</Button>
				)}
			</div>
		</div>
	);
}

/** Troca de responsável (visual): escolher outra pessoa com celular. */
export function ChangeCarerContent({
	name,
	carers,
	value,
	busy,
	error,
	unchanged,
	onChange,
	onSubmit,
	onCancel,
}: Readonly<{
	name: string;
	carers: Member[];
	value: string;
	busy: boolean;
	error: string | null;
	unchanged: boolean;
	onChange: (uid: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}>) {
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">Quem vai cuidar de {name} daqui para a frente?</p>
			<CarerPicker label="Quem cuida?" carers={carers} value={value} onChange={onChange} />
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button onClick={onSubmit} loading={busy} disabled={unchanged || busy} fullWidth icon={busy ? undefined : "check"}>
					{busy ? "Salvando..." : "Trocar responsável"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Voltar
				</Button>
			</div>
		</div>
	);
}
