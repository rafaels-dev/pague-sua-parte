import { ObjectId, type Db } from "mongodb";
import { payerPix } from "@/lib/expenses/payer-pix";
import { directory, expensesCollection, findMemberGroup, loadPeople, type Directory } from "@/lib/expenses/repo";
import { splitEqually } from "@/lib/expenses/split";
import { actsFor, canLaunchPaidBy, expenseRole, isObjectIdHex } from "@/lib/groups/helpers";
import type { GroupDoc } from "@/lib/groups/repo";
import { recurrencesCollection, type RecurrenceDoc } from "./collection";
import { materializeSafely } from "./materialize";
import { dueDateFor, resolveParticipants, type ParticipantMode } from "./period";
import type { RecurrenceInput, RecurrencePatch } from "./validation";

export type RecurrenceItem = {
	id: string;
	description: string;
	amountCents: number;
	dayOfMonth: number;
	participantMode: ParticipantMode;
	participantUids: string[];
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean; kind: "user" | "managed"; youManage: boolean };
	startPeriod: string;
	endPeriod: string | null;
	/** Vencimento do próximo mês a gerar (YYYY-MM-DD, com o dia limitado ao fim do mês). */
	nextDueDate: string;
	/** Quem age por quem paga ou administra o grupo. */
	canEdit: boolean;
};

const canEditRec = (r: RecurrenceDoc, group: GroupDoc, uid: string) => expenseRole(group.members, uid, r.paidBy) !== null;

function toItem(r: RecurrenceDoc, group: GroupDoc, dir: Directory, uid: string): RecurrenceItem {
	return {
		id: r._id.toHexString(),
		description: r.description,
		amountCents: r.amountCents,
		dayOfMonth: r.dayOfMonth,
		participantMode: r.participantMode,
		participantUids: r.participantMode === "selected" ? r.participantUids : [],
		paidBy: {
			uid: r.paidBy,
			name: dir.name(r.paidBy),
			picture: dir.picture(r.paidBy),
			isYou: r.paidBy === uid,
			kind: dir.kind(r.paidBy),
			youManage: dir.youManage(r.paidBy),
		},
		startPeriod: r.startPeriod,
		endPeriod: r.endPeriod ?? null,
		nextDueDate: dueDateFor(r.nextPeriod, r.dayOfMonth),
		canEdit: canEditRec(r, group, uid),
	};
}

async function itemsFor(db: Db, group: GroupDoc, recs: RecurrenceDoc[], uid: string): Promise<RecurrenceItem[]> {
	const uids = new Set(recs.map((r) => r.paidBy));
	for (const u of [...uids]) {
		const by = group.members.find((m) => m.uid === u && m.kind === "managed")?.managedBy;
		if (by) uids.add(by);
	}
	const dir = directory(group, await loadPeople(db, [...uids]), uid);
	return recs.map((r) => toItem(r, group, dir, uid));
}

const byDayThenName = (a: RecurrenceDoc, b: RecurrenceDoc) => a.dayOfMonth - b.dayOfMonth || a.description.localeCompare(b.description, "pt-BR");

/** Valor e participantes cabem numa divisão em centavos? (mesma conferência do lançamento comum) */
function splittable(group: GroupDoc, r: Pick<RecurrenceDoc, "participantMode" | "participantUids" | "amountCents" | "paidBy">): boolean {
	const parts = resolveParticipants(r.participantMode, r.participantUids, group.members.map((m) => m.uid), r.paidBy);
	try {
		splitEqually(r.amountCents, parts, r.paidBy);
		return true;
	} catch {
		return false;
	}
}

const allMembers = (group: GroupDoc, uids: string[]) => uids.every((u) => group.members.some((m) => m.uid === u));
const BAD_MEMBERS = { field: "participantUids", error: "Escolha apenas pessoas que estão no grupo." };
const TOO_SMALL = { field: "amountCents", error: "Esse valor é pequeno demais para dividir entre tantas pessoas." };

// ---------- listar ----------

/** null se o grupo não existe ou `uid` não é membro. Só as ativas. */
export async function listRecurrences(db: Db, groupId: string, uid: string): Promise<RecurrenceItem[] | null> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return null;
	const recs = await recurrencesCollection(db).find({ groupId: group._id, active: true }).toArray();
	// Quem pagava e saiu do grupo: a recorrência se encerra na próxima leitura de despesas; já não aparece aqui.
	const live = recs.filter((r) => group.members.some((m) => m.uid === r.paidBy)).sort(byDayThenName);
	return itemsFor(db, group, live, uid);
}

// ---------- criar ----------

export type CreateRecurrenceResult =
	| { status: "ok"; recurrence: RecurrenceItem; firstExpenseId: string | null }
	| { status: "no_group" }
	| { status: "no_pix"; name?: string }
	| { status: "invalid"; error: string; field: string };

export async function createRecurrence(
	db: Db,
	args: { groupId: string; uid: string; input: RecurrenceInput; now?: Date },
): Promise<CreateRecurrenceResult> {
	const { groupId, uid, input } = args;
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };

	const paidBy = input.paidByUid ?? uid;
	if (!canLaunchPaidBy(group.members, uid, paidBy)) {
		return { status: "invalid", field: "paidByUid", error: "Você só pode lançar despesas pagas por você, por quem você cuida ou, se for administrador, por alguém do grupo." };
	}
	// Só o administrador lançando por OUTRA pessoa pode deixar a chave Pix para depois (cada mês usa a chave de quem paga AGORA).
	const onBehalf = paidBy !== uid && !actsFor(group.members, uid, paidBy);
	if (!onBehalf && !(await payerPix(db, group, paidBy))) {
		return paidBy === uid ? { status: "no_pix" } : { status: "no_pix", name: group.members.find((m) => m.uid === paidBy)?.name?.trim() || "Participante" };
	}
	if (!allMembers(group, input.participantUids)) return { status: "invalid", ...BAD_MEMBERS };
	if (!splittable(group, { ...input, paidBy })) return { status: "invalid", ...TOO_SMALL };

	const doc: RecurrenceDoc = {
		_id: new ObjectId(),
		groupId: group._id,
		createdBy: uid,
		paidBy,
		description: input.description,
		amountCents: input.amountCents,
		dayOfMonth: input.dayOfMonth,
		participantMode: input.participantMode,
		participantUids: input.participantMode === "selected" ? input.participantUids : [],
		startPeriod: input.startPeriod,
		...(input.endPeriod ? { endPeriod: input.endPeriod } : {}),
		nextPeriod: input.startPeriod,
		active: true,
		createdAt: now,
		updatedAt: now,
	};
	await recurrencesCollection(db).insertOne(doc);
	await materializeSafely(db, [group._id], now, { recurrenceId: doc._id.toHexString(), uid });

	const first = await expensesCollection(db).findOne(
		{ groupId: group._id, "recurrence.id": doc._id.toHexString() },
		{ projection: { _id: 1 }, sort: { "recurrence.period": 1 } },
	);
	const fresh = (await recurrencesCollection(db).findOne({ _id: doc._id })) ?? doc;
	const [recurrence] = await itemsFor(db, group, [fresh], uid);
	return { status: "ok", recurrence, firstExpenseId: first ? first._id.toHexString() : null };
}

// ---------- alterar / encerrar ----------

export type UpdateRecurrenceResult =
	| { status: "ok"; recurrence: RecurrenceItem }
	| { status: "no_group" }
	| { status: "no_recurrence" }
	| { status: "forbidden" }
	| { status: "invalid"; error: string; field: string };

async function findRecurrence(db: Db, group: GroupDoc, rid: string, onlyActive: boolean) {
	if (!isObjectIdHex(rid)) return null;
	return recurrencesCollection(db).findOne({ _id: new ObjectId(rid), groupId: group._id, ...(onlyActive ? { active: true } : {}) });
}

/** Vale só para os meses ainda não gerados. */
export async function updateRecurrence(
	db: Db,
	args: { groupId: string; rid: string; uid: string; patch: RecurrencePatch; now?: Date },
): Promise<UpdateRecurrenceResult> {
	const { groupId, rid, uid, patch } = args;
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const r = await findRecurrence(db, group, rid, true);
	if (!r) return { status: "no_recurrence" };
	if (!canEditRec(r, group, uid)) return { status: "forbidden" };

	const mode = patch.participantMode ?? r.participantMode;
	const uids = mode === "selected" ? (patch.participantUids ?? r.participantUids) : [];
	if (mode === "selected" && uids.length === 0) return { status: "invalid", field: "participantUids", error: "Escolha quem divide a despesa." };
	if (!allMembers(group, uids)) return { status: "invalid", ...BAD_MEMBERS };
	const merged = { ...r, participantMode: mode, participantUids: uids, amountCents: patch.amountCents ?? r.amountCents };
	if (!splittable(group, merged)) return { status: "invalid", ...TOO_SMALL };

	const set: Partial<RecurrenceDoc> = { updatedAt: now, participantMode: mode, participantUids: uids };
	const unset: Record<string, ""> = {};
	if (patch.description !== undefined) set.description = patch.description;
	if (patch.amountCents !== undefined) set.amountCents = patch.amountCents;
	if (patch.dayOfMonth !== undefined) set.dayOfMonth = patch.dayOfMonth;
	if (patch.endPeriod !== undefined) {
		if (patch.endPeriod === null) unset.endPeriod = "";
		else {
			if (patch.endPeriod < r.startPeriod) return { status: "invalid", field: "endPeriod", error: "O mês final não pode ser anterior ao inicial." };
			set.endPeriod = patch.endPeriod;
			// Acabar antes do próximo mês a gerar = nada mais a gerar.
			if (patch.endPeriod < r.nextPeriod) {
				set.active = false;
				set.endedAt = now;
			}
		}
	}
	const res = await recurrencesCollection(db).findOneAndUpdate(
		{ _id: r._id, active: true },
		{ $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
		{ returnDocument: "after" },
	);
	if (!res) return { status: "no_recurrence" };
	const [recurrence] = await itemsFor(db, group, [res], uid);
	return { status: "ok", recurrence };
}

export type EndRecurrenceResult = { status: "ok" } | { status: "no_group" } | { status: "no_recurrence" } | { status: "forbidden" };

/** "Encerrar": para de gerar; as despesas já geradas ficam. Repetir é inofensivo. */
export async function endRecurrence(db: Db, args: { groupId: string; rid: string; uid: string; now?: Date }): Promise<EndRecurrenceResult> {
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, args.groupId, args.uid);
	if (!group) return { status: "no_group" };
	const r = await findRecurrence(db, group, args.rid, false);
	if (!r) return { status: "no_recurrence" };
	if (!canEditRec(r, group, args.uid)) return { status: "forbidden" };
	await recurrencesCollection(db).updateOne({ _id: r._id, active: true }, { $set: { active: false, endedAt: now, updatedAt: now } });
	return { status: "ok" };
}
