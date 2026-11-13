import { Banner, Button } from "@/components/ui";
import type { Member } from "./group-detail";

/** Conteúdo (visual) do sheet de opções de uma pessoa: mudar papel e remover do grupo. */
export function MemberSheetContent({
	member,
	busy,
	error,
	confirmingRemove,
	allowReturn = true,
	onAllowReturn,
	onToggleRole,
	onAskRemove,
	onCancelRemove,
	onConfirmRemove,
}: Readonly<{
	member: Pick<Member, "name" | "role">;
	busy: boolean;
	error: string | null;
	confirmingRemove: boolean;
	/** "Permitir que a pessoa volte ao grupo" (marcado por padrão). */
	allowReturn?: boolean;
	onAllowReturn?: (value: boolean) => void;
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
				<p className="text-body-large text-on-surface">Remover {member.name} do grupo?</p>
				<label className="flex cursor-pointer items-start gap-3">
					<input type="checkbox" checked={allowReturn} disabled={busy} onChange={(e) => onAllowReturn?.(e.target.checked)} className="mt-0.5 size-6 shrink-0 cursor-pointer accent-primary" />
					<span className="space-y-1">
						<span className="block text-body-large">Permitir que a pessoa volte ao grupo</span>
						<span className="block text-body-medium text-on-surface-variant">Se desmarcar, ela não entra de novo por nenhum link.</span>
					</span>
				</label>
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
