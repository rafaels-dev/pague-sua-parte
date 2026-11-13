import type { PixKeyType } from "@/lib/pix/key";

export type Member = {
	uid: string;
	name: string;
	picture: string | null;
	role: "admin" | "member";
	hasPixKey: boolean;
	isYou: boolean;
	/** "managed" = pessoa sem celular, cuidada por outro membro. */
	kind: "user" | "managed";
	managedBy: { uid: string; name: string; isYou: boolean } | null;
	/** Você é o responsável por esta pessoa. */
	youManage: boolean;
	/** Você pode editar esta pessoa (admin ou responsável). */
	canEdit: boolean;
	/** Só vem para pessoas sem celular quando `canEdit`. */
	pixKey: { type: PixKeyType; key: string } | null;
};
export type Group = {
	id: string;
	name: string;
	role: "admin" | "member";
	members: Member[];
	/** Só para o administrador: quem não pode voltar por nenhum link. */
	blocked?: { uid: string; name: string }[];
};

type RawMember = Partial<Member> & Pick<Member, "uid" | "name">;

/** Completa os campos de "pessoa sem celular" quando o servidor ainda manda o formato antigo. */
export function normalizeMember(raw: RawMember): Member {
	const managedBy = raw.managedBy && typeof raw.managedBy === "object" ? { uid: raw.managedBy.uid ?? "", name: raw.managedBy.name ?? "", isYou: !!raw.managedBy.isYou } : null;
	const kind = raw.kind === "managed" ? "managed" : "user";
	return {
		uid: raw.uid,
		name: raw.name,
		picture: raw.picture ?? null,
		role: raw.role === "admin" ? "admin" : "member",
		hasPixKey: raw.hasPixKey ?? !!raw.pixKey,
		isYou: !!raw.isYou,
		kind,
		managedBy: kind === "managed" ? managedBy : null,
		youManage: kind === "managed" && (raw.youManage ?? managedBy?.isYou ?? false),
		canEdit: !!raw.canEdit,
		pixKey: raw.pixKey ?? null,
	};
}

export function normalizeGroupDetail(raw: Omit<Group, "members"> & { members?: RawMember[] }): Group {
	return { ...raw, members: (raw.members ?? []).map(normalizeMember) };
}

/** Pessoas sem celular que a pessoa logada cuida. */
export function managedByYou(members: Pick<Member, "kind" | "youManage">[]): number {
	return members.filter((m) => m.kind === "managed" && m.youManage).length;
}
