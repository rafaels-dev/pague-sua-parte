import { Banner, Button } from "@/components/ui";
import type { Member } from "./group-detail";

/** Conteúdo (visual) do sheet de opções de uma pessoa: mudar papel e remover do grupo. */
export function MemberSheetContent({
	member,
	busy,
	error,
	confirmingRemove,
	onToggleRole,
	onAskRemove,
	onCancelRemove,
	onConfirmRemove,
}: Readonly<{
	member: Pick<Member, "name" | "role">;
	busy: boolean;
	error: string | null;
	confirmingRemove: boolean;
	onToggleRole: () => void;
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
				<p className="text-body-large text-on-surface">Remover {member.name} do grupo? Essa pessoa só volta com um novo convite.</p>
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

	const isAdmin = member.role === "admin";
	return (
		<div className="space-y-4">
			<p className="text-body-large text-on-surface-variant">
				Quem administra o grupo pode remover pessoas, gerar novo link de convite e definir administradores.
			</p>
			{errorBanner}
			<div className="flex flex-col gap-3">
				<Button variant="tonal" icon={isAdmin ? "person" : "group"} onClick={onToggleRole} loading={busy} disabled={busy} fullWidth>
					{isAdmin ? "Tirar de administrador" : "Tornar administrador"}
				</Button>
				<Button variant="text" icon="logout" onClick={onAskRemove} disabled={busy} fullWidth className="text-error!">
					Remover do grupo
				</Button>
			</div>
		</div>
	);
}
