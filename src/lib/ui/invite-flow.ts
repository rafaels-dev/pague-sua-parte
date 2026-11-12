import { destinationGroupId, groupDestination, safeInviteDestination } from "./share-link";

export type InvitePreviewLite = { groupId: string; alreadyMember: boolean };

/** O que a página de convite faz depois de abrir o convite com sucesso. */
export type InviteLoadedAction =
	/** Já é do grupo e o destino é válido: vai direto, sem perguntar nada. */
	| { kind: "redirect"; to: string }
	/** Já é do grupo, mas o `ir` não vale (outro grupo, forma estranha): avisa e oferece abrir o grupo. */
	| { kind: "member-bad-destination"; to: string }
	/** Já é do grupo, sem destino: tela "Você já está no grupo". */
	| { kind: "member" }
	/** Ainda não é do grupo: tela do convite; ao aceitar vai para `to`. */
	| { kind: "offer"; to: string };

/** Para onde vai quem acabou de entrar: o destino válido ou a página do grupo. */
export function afterAcceptPath(groupId: string, destination: string | null): string {
	return safeInviteDestination(destination, groupId) ?? groupDestination(groupId);
}

export function onInviteLoaded(invite: InvitePreviewLite, destination: string | null): InviteLoadedAction {
	const valid = safeInviteDestination(destination, invite.groupId);
	const group = groupDestination(invite.groupId);
	if (!invite.alreadyMember) return { kind: "offer", to: afterAcceptPath(invite.groupId, destination) };
	if (valid) return { kind: "redirect", to: valid };
	return destination ? { kind: "member-bad-destination", to: group } : { kind: "member" };
}

/** O que a página faz quando o convite não abre (vencido, trocado, inválido). */
export type InviteFailedAction =
	/** O `ir` tem forma válida: tenta abrir o grupo (a API confere se é membro); só vai se responder 200. */
	| { kind: "probe"; groupId: string; to: string }
	| { kind: "error" };

export function onInviteFailed(destination: string | null): InviteFailedAction {
	const gid = destinationGroupId(destination);
	return gid && destination ? { kind: "probe", groupId: gid, to: destination } : { kind: "error" };
}
