import type { Db, ObjectId } from "mongodb";
import type { AttachmentMeta } from "@/lib/storage/attachments";

/** `open`: recebendo respostas. `closing`: virando grupo + despesa neste instante. `done`: virou grupo. `cancelled`: cancelado. */
export type PlanStatus = "open" | "closing" | "done" | "cancelled";

export type PlanParticipant = { uid: string; joinedAt: Date };
/** Pessoa sem celular acrescentada por um participante (só o nome); responde pelo participante `addedBy`. */
export type PlanGuest = { id: string; name: string; addedBy: string };
/** Resposta de uma pessoa do plano (`who` = uid do participante ou id do convidado sem celular). */
export type PlanResponse = { who: string; going: boolean; limitCents?: number; by: string; at: Date };

export type PlanDoc = {
	_id: ObjectId;
	name: string;
	totalCents: number;
	/** Data limite para responder (YYYY-MM-DD); só informativa. */
	deadline?: string;
	/** Quando vai ser (YYYY-MM-DD). */
	eventDate?: string;
	/** Texto livre (links, observações). */
	details?: string;
	/** Quantas pessoas o criador pensa em chamar (só a quantidade; não muda a conta de quem fecha). */
	expectedPeople?: number;
	createdBy: string;
	status: PlanStatus;
	participants: PlanParticipant[];
	guests: PlanGuest[];
	responses: PlanResponse[];
	attachments: AttachmentMeta[];
	invite: { token: string; expiresAt: Date } | null;
	/** Preenchidos quando o plano vira grupo + despesa. */
	groupId?: string;
	groupName?: string;
	expenseId?: string;
	/**
	 * Enquanto `closing`: a tentativa em andamento. Os códigos do grupo e da despesa são sorteados ANTES e gravados junto com a
	 * reserva, para o desfazer sempre saber o que apagar; `attemptId` identifica a tentativa (só ela conclui ou desfaz).
	 */
	closing?: { at: Date; attemptId: string; groupId: string; expenseId: string };
	/** Quem o criador tirou do plano: não volta pelo mesmo link. (Quem saiu por conta própria pode voltar.) */
	removed?: string[];
	/** Cresce a cada escrita (concorrência otimista). */
	version: number;
	createdAt: Date;
	updatedAt: Date;
};

export const MAX_PLAN_PEOPLE = 50;
export const MAX_GUESTS_PER_PERSON = 5;
export const MAX_PLAN_PHOTOS = 3;
export const PLAN_INVITE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Um fechamento "preso" há mais que isto é desfeito (muito além da duração máxima de uma função da Vercel). */
export const CLOSING_STALE_MS = 5 * 60 * 1000;
export const GUEST_PREFIX = "pg_";

export const isGuestId = (id: string) => id.startsWith(GUEST_PREFIX);

export function plansCollection(db: Db) {
	return db.collection<PlanDoc>("plans");
}

/** Quem conta na divisão: participantes e pessoas sem celular, nesta ordem. */
export function peopleOf(p: Pick<PlanDoc, "participants" | "guests">): string[] {
	return [...p.participants.map((x) => x.uid), ...p.guests.map((g) => g.id)];
}
