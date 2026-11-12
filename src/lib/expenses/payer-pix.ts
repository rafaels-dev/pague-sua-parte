import type { Db } from "mongodb";
import type { GroupDoc } from "@/lib/groups/repo";
import type { PixKey } from "@/lib/pix/key";
import { usersCollection } from "@/lib/users/repo";

export type PayerPix = PixKey & { payeeName: string };

/**
 * Chave Pix de quem paga AGORA: a cadastrada no grupo (pessoa sem login) ou a do próprio usuário.
 * null se a pessoa não tem chave ou não está no grupo. Módulo-folha: não importa nada do domínio de despesas.
 */
export async function payerPix(db: Db, group: Pick<GroupDoc, "members">, payer: string): Promise<PayerPix | null> {
	const member = group.members.find((m) => m.uid === payer);
	if (!member) return null;
	if (member.kind === "managed") {
		return member.pixKey ? { type: member.pixKey.type, key: member.pixKey.key, payeeName: member.name?.trim() || "Participante" } : null;
	}
	const u = await usersCollection(db).findOne({ _id: payer }, { projection: { name: 1, displayName: 1, pixKey: 1 } });
	return u?.pixKey ? { type: u.pixKey.type, key: u.pixKey.key, payeeName: u.displayName?.trim() || u.name || "Participante" } : null;
}
