import { ObjectId, type Db } from "mongodb";
import { createExpense as realCreateExpense } from "@/lib/expenses/repo";
import { generateManagedUid } from "@/lib/groups/helpers";
import { groupsCollection, type GroupDoc, type GroupMember } from "@/lib/groups/repo";
import type { NewExpenseFact } from "@/lib/notifications/types";
import type { AttachmentStore } from "@/lib/storage/attachments";
import { randomId } from "@/lib/storage/attachments";
import { usersCollection } from "@/lib/users/repo";
import { rollbackAttempt } from "./closing";
import { isGuestId, peopleOf, plansCollection, type PlanDoc } from "./collection";
import { findPlanFor } from "./repo";
import { parseCloseInput } from "./validation";

export type CloseResult =
	| { status: "ok"; groupId: string; expenseId: string; doc: PlanDoc; newExpense?: NewExpenseFact; notChosenGoing: string[] }
	| { status: "no_plan" | "forbidden" | "not_open" | "conflict" }
	| { status: "invalid"; field: string; error: string }
	| { status: "no_pix"; name?: string };

type Deps = {
	createExpense: typeof realCreateExpense;
	/** O usuário tem chave Pix cadastrada? */
	hasPix: (db: Db, uid: string) => Promise<boolean>;
};

const realDeps: Deps = {
	createExpense: realCreateExpense,
	hasPix: async (db, uid) => !!(await usersCollection(db).findOne({ _id: uid }, { projection: { pixKey: 1 } }))?.pixKey,
};

/** Quem disse "Vou" (pessoas atuais do plano). Só essas entram na divisão: ninguém é cobrado sem ter respondido que vai. */
export function goingSet(plan: Pick<PlanDoc, "participants" | "guests" | "responses">): Set<string> {
	const people = new Set(peopleOf(plan));
	return new Set(plan.responses.filter((r) => r.going && people.has(r.who)).map((r) => r.who));
}

/**
 * "Criar grupo e despesa": só o criador, com o plano aberto. Uma operação com compensação explícita (o projeto não usa
 * transação):
 * - valida TUDO antes de reservar (quem divide e quem paga disseram "Vou"; quem paga tem login e, sendo o criador, Pix);
 * - reserva `open -> closing` (filtro por status e versão: impede o duplo clique) gravando um `attemptId` e os códigos que
 *   serão do grupo e da despesa; só essa tentativa conclui (`closing -> done`) ou desfaz (por códigos, não por `planId` solto);
 * - cria o grupo (criador = administrador) e a despesa pela função do lançamento. Qualquer falha apaga o que a própria
 *   tentativa criou e devolve o plano para `open`. Uma tentativa lenta que perdeu o plano para a recuperação apaga só o que
 *   ela criou e responde `conflict`.
 * Centavos: a parte do plano é o teto da divisão; na despesa, quem pagou fica com a sobra (`splitEqually`).
 */
export async function closePlan(
	db: Db,
	store: AttachmentStore,
	uid: string,
	pid: string,
	rawBody: unknown,
	deps: Deps = realDeps,
	now: Date = new Date(),
): Promise<CloseResult> {
	const plan = await findPlanFor(db, pid, uid, now); // já recupera um fechamento preso
	if (!plan) return { status: "no_plan" };
	if (plan.createdBy !== uid) return { status: "forbidden" };
	if (plan.status !== "open") return { status: "not_open" };

	const parsed = parseCloseInput(rawBody, plan, now);
	if (!parsed.ok) return { status: "invalid", field: parsed.field, error: parsed.error };
	const input = parsed.value;
	const going = goingSet(plan);
	if (!input.participantIds.every((p) => going.has(p))) {
		return { status: "invalid", field: "participantIds", error: "Só entra na divisão quem disse que vai." };
	}
	if (isGuestId(input.paidBy) || !plan.participants.some((p) => p.uid === input.paidBy)) {
		return { status: "invalid", field: "paidBy", error: "Quem pagou precisa ser alguém que usa o app e disse que vai." };
	}
	if (input.paidBy === uid && !(await deps.hasPix(db, uid))) return { status: "no_pix" };

	const attemptId = randomId();
	const groupObjectId = new ObjectId();
	const expenseObjectId = new ObjectId();
	const closing = { at: now, attemptId, groupId: groupObjectId.toHexString(), expenseId: expenseObjectId.toHexString() };
	const reserved = await plansCollection(db).updateOne(
		{ _id: plan._id, createdBy: uid, status: "open", version: plan.version },
		{ $set: { status: "closing", closing, updatedAt: now }, $inc: { version: 1 } },
	);
	if (reserved.matchedCount === 0) {
		const again = await findPlanFor(db, pid, uid, now);
		return { status: again && again.status === "open" ? "conflict" : "not_open" };
	}

	let newExpense: NewExpenseFact | undefined;
	try {
		// Quem entra no grupo: o criador (administrador), os participantes escolhidos, as pessoas sem celular escolhidas
		// (cuidadas por quem as acrescentou) e, se preciso, esse responsável (sem parte na despesa).
		const members: GroupMember[] = [{ uid, role: "admin", joinedAt: now }];
		const has = (u: string) => members.some((m) => m.uid === u);
		const mapped = new Map<string, string>(); // id no plano -> uid no grupo
		for (const id of input.participantIds) {
			if (isGuestId(id)) continue;
			mapped.set(id, id);
			if (!has(id)) members.push({ uid: id, role: "member", joinedAt: now });
		}
		for (const id of input.participantIds) {
			if (!isGuestId(id)) continue;
			const guest = plan.guests.find((g) => g.id === id)!;
			if (!has(guest.addedBy)) members.push({ uid: guest.addedBy, role: "member", joinedAt: now });
			const managedUid = generateManagedUid();
			mapped.set(id, managedUid);
			members.push({ uid: managedUid, role: "member", kind: "managed", name: guest.name, managedBy: guest.addedBy, joinedAt: now });
		}

		const group: GroupDoc = { _id: groupObjectId, name: input.groupName, createdBy: uid, members, invite: null, createdAt: now, updatedAt: now };
		await groupsCollection(db).insertOne(group);

		const payer = mapped.get(input.paidBy)!;
		const created = await deps.createExpense(db, store, {
			groupId: closing.groupId,
			uid,
			input: {
				description: plan.name,
				amountCents: plan.totalCents,
				date: input.date,
				participantUids: input.participantIds.map((id) => mapped.get(id)!),
				...(payer !== uid ? { paidByUid: payer } : {}),
				...(input.dueDate ? { dueDate: input.dueDate } : {}),
			},
			files: [],
			planId: pid,
			expenseId: closing.expenseId,
			now,
		});
		if (created.status !== "ok") {
			await rollbackAttempt(db, plan._id, closing);
			if (created.status === "no_pix") return { status: "no_pix", ...(created.name ? { name: created.name } : {}) };
			if (created.status === "invalid") return { status: "invalid", field: created.field, error: created.error };
			return { status: "conflict" };
		}

		newExpense = created.newExpense;
		const done = await plansCollection(db).updateOne(
			{ _id: plan._id, status: "closing", "closing.attemptId": attemptId },
			{ $set: { status: "done", closedAttemptId: attemptId, groupId: closing.groupId, groupName: input.groupName, expenseId: closing.expenseId, updatedAt: new Date() }, $unset: { closing: "" }, $inc: { version: 1 } },
		);
		if (done.matchedCount === 0) {
			// A recuperação desfez esta tentativa (ela demorou demais): apaga só o que ELA criou e falha limpo.
			await rollbackAttempt(db, plan._id, closing);
			return { status: "conflict" };
		}
		return success(input.participantIds, created.newExpense);
	} catch (err) {
		// A gravação do `done` pode ter chegado ao banco com a resposta perdida: se o plano já está concluído por ESTA
		// tentativa, não apaga nada (grupo e despesa são de um fechamento que deu certo) e devolve sucesso.
		try {
			const now = await plansCollection(db).findOne({ _id: plan._id });
			if (now?.status === "done" && now.closedAttemptId === attemptId) return success(input.participantIds, newExpense);
		} catch {
			// sem como conferir: segue para o desfazer, como antes
		}
		await rollbackAttempt(db, plan._id, closing);
		throw err;
	}

	function success(chosenIds: string[], fact: NewExpenseFact | undefined): CloseResult {
		const chosen = new Set(chosenIds);
		return {
			status: "ok",
			groupId: closing.groupId,
			expenseId: closing.expenseId,
			doc: { ...plan!, status: "done", groupId: closing.groupId, groupName: input.groupName, expenseId: closing.expenseId },
			newExpense: fact,
			notChosenGoing: [...going].filter((w) => !chosen.has(w)),
		};
	}
}
