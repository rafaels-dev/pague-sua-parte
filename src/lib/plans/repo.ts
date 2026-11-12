import { ObjectId, type Db } from "mongodb";
import { loadPeople } from "@/lib/expenses/repo";
import { isObjectIdHex, isPlausibleToken, generateInviteToken } from "@/lib/groups/helpers";
import { groupsCollection } from "@/lib/groups/repo";
import { deleteAttachments, putPlanAttachment, randomId, type AttachmentMeta, type AttachmentStore } from "@/lib/storage/attachments";
import type { SniffedFile } from "@/lib/expenses/validation";
import { recoverIfStale } from "./closing";
import { allCountOf, computeFor, buildPlanSummary, buildPlanView, canAnswerFor, type PersonInfo, type PlanSummary, type PlanView } from "./view";
import { maxShare, type PlanComputation } from "./compute";
import {
	GUEST_PREFIX,
	MAX_GUESTS_PER_PERSON,
	MAX_PLAN_PEOPLE,
	MAX_PLAN_PHOTOS,
	PLAN_INVITE_TTL_MS,
	peopleOf,
	plansCollection,
	type PlanDoc,
	type PlanStatus,
} from "./collection";
import type { PlanInput, ResponseInput } from "./validation";

const RETRIES = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plano em que `uid` participa (ou null): único jeito de ler um plano. Um fechamento preso é desfeito aqui, na leitura. */
export async function findPlanFor(db: Db, pid: string, uid: string, now: Date = new Date()): Promise<PlanDoc | null> {
	if (!isObjectIdHex(pid)) return null;
	const plan = await plansCollection(db).findOne({ _id: new ObjectId(pid), "participants.uid": uid });
	return plan ? recoverIfStale(db, plan, now) : null;
}

/** Nomes e fotos de quem participa (projeção explícita: sem e-mail nem chave Pix). */
export async function loadInfo(db: Db, plan: PlanDoc): Promise<(uid: string) => PersonInfo> {
	const people = await loadPeople(db, plan.participants.map((p) => p.uid));
	return (uid) => {
		const u = people.get(uid);
		return { name: u?.displayName?.trim() || u?.name || "Participante", picture: u?.picture ?? null };
	};
}

export async function toView(db: Db, plan: PlanDoc, uid: string): Promise<PlanView> {
	const info = await loadInfo(db, plan);
	let closed: { groupId: string | null } | null = null;
	if (plan.status === "done" && plan.groupId && isObjectIdHex(plan.groupId)) {
		const g = await groupsCollection(db).findOne({ _id: new ObjectId(plan.groupId), "members.uid": uid }, { projection: { _id: 1 } });
		closed = { groupId: g ? plan.groupId : null };
	}
	return buildPlanView(plan, uid, info, closed);
}

export async function getPlanView(db: Db, pid: string, uid: string): Promise<PlanView | null> {
	const plan = await findPlanFor(db, pid, uid);
	return plan ? toView(db, plan, uid) : null;
}

export const LIST_LIMIT = 100;

/** Planos do usuário. `open`: em andamento; `old`: fechados e cancelados (mais novos primeiro). */
export async function listPlans(db: Db, uid: string, scope: "open" | "old"): Promise<PlanSummary[]> {
	const status: PlanStatus[] = scope === "open" ? ["open", "closing"] : ["done", "cancelled"];
	const docs = await plansCollection(db)
		.find({ "participants.uid": uid, status: { $in: status } })
		.sort({ createdAt: -1, _id: -1 })
		.limit(LIST_LIMIT)
		.toArray();
	const fresh = await Promise.all(docs.map((p) => recoverIfStale(db, p)));
	return fresh.filter((p) => status.includes(p.status)).map((p) => buildPlanSummary(p, uid));
}

// ---------- escrita com controle otimista ----------

type Mutation = { reject: string } | { set: Partial<PlanDoc>; unset?: (keyof PlanDoc)[] };
export type Mutated =
	| { kind: "no_plan" }
	| { kind: "rejected"; reason: string }
	| { kind: "conflict" }
	| { kind: "ok"; doc: PlanDoc; before: PlanDoc };

/** Lê, decide (`mutate` é pura) e grava só se ninguém mexeu no meio (`version`); tenta de novo em conflito. */
export async function mutatePlan(db: Db, pid: string, uid: string, mutate: (p: PlanDoc) => Mutation): Promise<Mutated> {
	for (let attempt = 0; attempt <= RETRIES; attempt++) {
		if (attempt > 0) await sleep(10 + Math.random() * 50); // espera curta e aleatória: evita quem briga ficar em compasso
		const plan = await findPlanFor(db, pid, uid);
		if (!plan) return { kind: "no_plan" };
		const m = mutate(plan);
		if ("reject" in m) return { kind: "rejected", reason: m.reject };
		const now = new Date();
		const res = await plansCollection(db).updateOne(
			{ _id: plan._id, version: plan.version },
			{
				$set: { ...m.set, updatedAt: now },
				...(m.unset?.length ? { $unset: Object.fromEntries(m.unset.map((k) => [k, ""])) } : {}),
				$inc: { version: 1 },
			},
		);
		if (res.matchedCount > 0) {
			const doc: PlanDoc = { ...plan, ...m.set, version: plan.version + 1, updatedAt: now };
			for (const k of m.unset ?? []) delete doc[k];
			return { kind: "ok", doc, before: plan };
		}
	}
	return { kind: "conflict" };
}

// ---------- criar / editar / cancelar ----------

export async function createPlan(db: Db, store: AttachmentStore, uid: string, input: PlanInput, files: SniffedFile[]): Promise<PlanView> {
	const _id = new ObjectId();
	const uploaded: AttachmentMeta[] = [];
	try {
		for (const f of files) uploaded.push(await putPlanAttachment(store, { planId: _id.toHexString(), bytes: f.bytes, name: f.name, contentType: f.contentType }));
		const now = new Date();
		const doc: PlanDoc = {
			_id,
			...input,
			createdBy: uid,
			status: "open",
			participants: [{ uid, joinedAt: now }],
			guests: [],
			responses: [],
			attachments: uploaded,
			invite: null,
			version: 0,
			createdAt: now,
			updatedAt: now,
		};
		await plansCollection(db).insertOne(doc);
		return await toView(db, doc, uid);
	} catch (err) {
		await deleteAttachments(store, uploaded.map((a) => a.key));
		throw err;
	}
}

export type PlanChange =
	| { kind: "ok"; view: PlanView; before: PlanDoc; doc: PlanDoc }
	| { kind: "no_plan" }
	| { kind: "forbidden" }
	| { kind: "closed" }
	| { kind: "conflict" }
	| { kind: "limit" }
	| { kind: "too_many" };

async function finish(db: Db, uid: string, m: Mutated, reasons: Record<string, PlanChange> = {}): Promise<PlanChange> {
	switch (m.kind) {
		case "no_plan":
			return { kind: "no_plan" };
		case "conflict":
			return { kind: "conflict" };
		case "rejected":
			return reasons[m.reason] ?? { kind: "closed" };
		case "ok":
			return { kind: "ok", view: await toView(db, m.doc, uid), before: m.before, doc: m.doc };
	}
}

/** Só quem criou o plano, com o plano aberto. */
const creatorOpen = (p: PlanDoc, uid: string): { reject: string } | null => (p.createdBy !== uid ? { reject: "forbidden" } : p.status !== "open" ? { reject: "closed" } : null);
const FORBIDDEN: Record<string, PlanChange> = { forbidden: { kind: "forbidden" }, closed: { kind: "closed" } };

export async function updatePlan(db: Db, pid: string, uid: string, input: PlanInput): Promise<PlanChange> {
	const m = await mutatePlan(db, pid, uid, (p) => {
		const bad = creatorOpen(p, uid);
		if (bad) return bad;
		const optional = ["deadline", "eventDate", "details", "expectedPeople"] as const;
		return {
			set: { name: input.name, totalCents: input.totalCents, ...Object.fromEntries(optional.filter((k) => input[k]).map((k) => [k, input[k]])) },
			unset: optional.filter((k) => !input[k]),
		};
	});
	return finish(db, uid, m, FORBIDDEN);
}

/** Cancela o plano e apaga as fotos do armazenamento (o plano cancelado mostra só texto). Plano fechado mantém as fotos. */
export async function cancelPlan(db: Db, store: AttachmentStore, pid: string, uid: string): Promise<PlanChange> {
	let keys: string[] = [];
	const m = await mutatePlan(db, pid, uid, (p) => {
		const bad = creatorOpen(p, uid);
		if (bad) return bad;
		keys = p.attachments.map((a) => a.key);
		return { set: { status: "cancelled", invite: null, attachments: [] } };
	});
	if (m.kind === "ok") await deleteAttachments(store, keys);
	return finish(db, uid, m, FORBIDDEN);
}

// ---------- respostas, convidados, participantes ----------

export async function setResponse(db: Db, pid: string, uid: string, who: string, input: ResponseInput): Promise<PlanChange> {
	const m = await mutatePlan(db, pid, uid, (p) => {
		if (p.status !== "open") return { reject: "closed" };
		if (!peopleOf(p).includes(who)) return { reject: "no_person" };
		if (!canAnswerFor(p, uid, who)) return { reject: "forbidden" };
		const existing = p.responses.find((r) => r.who === who);
		let limitCents: number | undefined;
		if (input.going) {
			// "Vou mesmo assim": o limite passa a ser a parte que a pessoa teria agora (calculada aqui, nunca vinda do cliente).
			limitCents = input.sameAsShare ? (computeFor(p).shareIfIncluded[who] ?? existing?.limitCents) : input.limitCents;
		}
		const next = { who, going: input.going, ...(limitCents ? { limitCents } : {}), by: uid, at: new Date() };
		return { set: { responses: [...p.responses.filter((r) => r.who !== who), next] } };
	});
	return finish(db, uid, m, { ...FORBIDDEN, no_person: { kind: "no_plan" } });
}

export async function addGuest(db: Db, pid: string, uid: string, name: string): Promise<PlanChange> {
	const m = await mutatePlan(db, pid, uid, (p) => {
		if (p.status !== "open") return { reject: "closed" };
		if (p.guests.filter((g) => g.addedBy === uid).length >= MAX_GUESTS_PER_PERSON || peopleOf(p).length >= MAX_PLAN_PEOPLE) return { reject: "limit" };
		return { set: { guests: [...p.guests, { id: GUEST_PREFIX + randomId(), name, addedBy: uid }] } };
	});
	return finish(db, uid, m, { ...FORBIDDEN, limit: { kind: "limit" } });
}

export async function removeGuest(db: Db, pid: string, uid: string, gid: string): Promise<PlanChange> {
	const m = await mutatePlan(db, pid, uid, (p) => {
		if (p.status !== "open") return { reject: "closed" };
		const g = p.guests.find((x) => x.id === gid);
		if (!g) return { reject: "no_person" };
		if (uid !== p.createdBy && g.addedBy !== uid) return { reject: "forbidden" };
		return { set: { guests: p.guests.filter((x) => x.id !== gid), responses: p.responses.filter((r) => r.who !== gid) } };
	});
	return finish(db, uid, m, { ...FORBIDDEN, no_person: { kind: "no_plan" } });
}

/** O criador tira um participante; cada participante pode sair. Leva junto as pessoas sem celular que ele acrescentou. */
export async function removeParticipant(db: Db, pid: string, uid: string, target: string): Promise<PlanChange> {
	const m = await mutatePlan(db, pid, uid, (p) => {
		if (p.status !== "open") return { reject: "closed" };
		if (!p.participants.some((x) => x.uid === target)) return { reject: "no_person" };
		if (target === p.createdBy || (uid !== p.createdBy && uid !== target)) return { reject: "forbidden" };
		const goneGuests = new Set(p.guests.filter((g) => g.addedBy === target).map((g) => g.id));
		return {
			set: {
				participants: p.participants.filter((x) => x.uid !== target),
				// Tirado pelo criador: não volta pelo mesmo link. Quem sai por conta própria pode voltar.
				...(target !== uid ? { removed: [...new Set([...(p.removed ?? []), target])] } : {}),
				guests: p.guests.filter((g) => !goneGuests.has(g.id)),
				responses: p.responses.filter((r) => r.who !== target && !goneGuests.has(r.who)),
			},
		};
	});
	return finish(db, uid, m, { ...FORBIDDEN, no_person: { kind: "no_plan" } });
}

// ---------- convite ----------

export type PlanInviteResult = { status: "ok"; token: string; expiresAt: Date } | { status: "not_found" } | { status: "forbidden" } | { status: "closed" };

const currentInvite = (p: PlanDoc, now: Date) => (p.invite && p.invite.expiresAt > now ? p.invite : null);

/** O link do plano (qualquer participante pega o atual); só quem criou o plano gera um novo, e o antigo para de valer. */
export async function getOrCreatePlanInvite(db: Db, pid: string, uid: string, regenerate: boolean): Promise<PlanInviteResult> {
	let result: PlanInviteResult = { status: "not_found" };
	if (!regenerate) {
		const plan = await findPlanFor(db, pid, uid);
		const existing = plan && plan.status === "open" ? currentInvite(plan, new Date()) : null;
		if (existing) return { status: "ok", token: existing.token, expiresAt: existing.expiresAt };
	}
	const m = await mutatePlan(db, pid, uid, (p) => {
		const now = new Date();
		if (p.status !== "open") return { reject: "closed" };
		if (regenerate && p.createdBy !== uid) return { reject: "forbidden" };
		const existing = currentInvite(p, now);
		if (existing && !regenerate) {
			result = { status: "ok", token: existing.token, expiresAt: existing.expiresAt };
			return { set: {} };
		}
		const invite = { token: generateInviteToken(), expiresAt: new Date(now.getTime() + PLAN_INVITE_TTL_MS) };
		result = { status: "ok", ...invite };
		return { set: { invite } };
	});
	if (m.kind === "no_plan") return { status: "not_found" };
	if (m.kind === "rejected") return m.reason === "forbidden" ? { status: "forbidden" } : { status: "closed" };
	if (m.kind === "conflict") throw new Error("Falha ao gerar o convite do plano.");
	return result;
}

export type PlanInvitePreview = {
	planId: string;
	planName: string;
	creatorName: string;
	totalCents: number;
	eventDate: string | null;
	peopleCount: number;
	/** A parte se forem as pessoas previstas (ou as que já estão no plano). */
	allCount: number;
	shareIfAllCents: number | null;
	alreadyParticipant: boolean;
};

async function findByToken(db: Db, token: string, now: Date): Promise<PlanDoc | null> {
	if (!isPlausibleToken(token)) return null;
	return plansCollection(db).findOne({ "invite.token": token, "invite.expiresAt": { $gt: now }, status: "open" });
}

export async function previewPlanInvite(db: Db, token: string, uid: string): Promise<PlanInvitePreview | null> {
	const plan = await findByToken(db, token, new Date());
	if (!plan) return null;
	const info = await loadInfo(db, plan);
	return {
		planId: plan._id.toHexString(),
		planName: plan.name,
		creatorName: info(plan.createdBy).name,
		totalCents: plan.totalCents,
		eventDate: plan.eventDate ?? null,
		peopleCount: peopleOf(plan).length,
		allCount: allCountOf(plan.expectedPeople, peopleOf(plan).length),
		shareIfAllCents: maxShare(plan.totalCents, allCountOf(plan.expectedPeople, peopleOf(plan).length)),
		alreadyParticipant: plan.participants.some((p) => p.uid === uid),
	};
}

export type AcceptPlanResult = { status: "ok"; planId: string; joined?: true } | { status: "invalid" } | { status: "full" } | { status: "removed" };

export async function acceptPlanInvite(db: Db, token: string, uid: string): Promise<AcceptPlanResult> {
	if (!isPlausibleToken(token)) return { status: "invalid" };
	const plans = plansCollection(db);
	const now = new Date();
	// Atômico: token válido, plano aberto, uid ainda fora, não removido pelo criador e com vaga.
	const res = await plans.findOneAndUpdate(
		{
			"invite.token": token,
			"invite.expiresAt": { $gt: now },
			status: "open",
			"participants.uid": { $ne: uid },
			removed: { $ne: uid },
			$expr: { $lt: [{ $add: [{ $size: "$participants" }, { $size: "$guests" }] }, MAX_PLAN_PEOPLE] },
		},
		{ $push: { participants: { uid, joinedAt: now } }, $set: { updatedAt: now }, $inc: { version: 1 } },
		{ returnDocument: "after", projection: { _id: 1 } },
	);
	if (res) return { status: "ok", planId: res._id.toHexString(), joined: true };
	const plan = await findByToken(db, token, now);
	if (!plan) return { status: "invalid" };
	if (plan.participants.some((p) => p.uid === uid)) return { status: "ok", planId: plan._id.toHexString() };
	if (plan.removed?.includes(uid)) return { status: "removed" };
	return { status: "full" };
}

// ---------- fotos ----------

export async function addPhotos(db: Db, store: AttachmentStore, pid: string, uid: string, files: SniffedFile[]): Promise<PlanChange> {
	const plan = await findPlanFor(db, pid, uid);
	if (!plan) return { kind: "no_plan" };
	if (plan.createdBy !== uid) return { kind: "forbidden" };
	if (plan.status !== "open") return { kind: "closed" };
	if (plan.attachments.length + files.length > MAX_PLAN_PHOTOS) return { kind: "too_many" };
	const uploaded: AttachmentMeta[] = [];
	try {
		for (const f of files) uploaded.push(await putPlanAttachment(store, { planId: pid, bytes: f.bytes, name: f.name, contentType: f.contentType }));
		const m = await mutatePlan(db, pid, uid, (p) => {
			const bad = creatorOpen(p, uid);
			if (bad) return bad;
			if (p.attachments.length + uploaded.length > MAX_PLAN_PHOTOS) return { reject: "too_many" };
			return { set: { attachments: [...p.attachments, ...uploaded] } };
		});
		if (m.kind === "rejected" && m.reason === "too_many") {
			await deleteAttachments(store, uploaded.map((a) => a.key));
			return { kind: "too_many" };
		}
		if (m.kind !== "ok") await deleteAttachments(store, uploaded.map((a) => a.key));
		return finish(db, uid, m, FORBIDDEN);
	} catch (err) {
		await deleteAttachments(store, uploaded.map((a) => a.key));
		throw err;
	}
}

/** Tira a foto do plano e apaga o objeto do armazenamento. */
export async function removePhoto(db: Db, store: AttachmentStore, pid: string, uid: string, aid: string): Promise<PlanChange> {
	let key: string | null = null;
	const m = await mutatePlan(db, pid, uid, (p) => {
		const bad = creatorOpen(p, uid);
		if (bad) return bad;
		const a = p.attachments.find((x) => x.id === aid);
		if (!a) return { reject: "no_person" };
		key = a.key;
		return { set: { attachments: p.attachments.filter((x) => x.id !== aid) } };
	});
	const out = await finish(db, uid, m, { ...FORBIDDEN, no_person: { kind: "no_plan" } });
	if (out.kind === "ok" && key) await deleteAttachments(store, [key]);
	return out;
}

/** Foto para exibir: qualquer participante (também depois de fechado ou cancelado). */
export async function getPhotoRef(db: Db, pid: string, uid: string, aid: string): Promise<{ key: string; name: string; contentType: string } | null> {
	const plan = await findPlanFor(db, pid, uid);
	const a = plan?.attachments.find((x) => x.id === aid);
	return a ? { key: a.key, name: a.name, contentType: a.contentType } : null;
}

export type { PlanComputation };
