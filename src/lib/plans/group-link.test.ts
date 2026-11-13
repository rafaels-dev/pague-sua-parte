import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { MAX_MEMBERS } from "@/lib/groups/helpers";
import type { PlanDoc } from "./collection";
import { GROUP_LINK_GRACE_DAYS, groupLinkLastDay, groupLinkOpen } from "./group-link";
import { acceptPlanInvite, previewPlanInvite } from "./repo";

const PID = "507f1f77bcf86cd799439011";
const GID = "507f1f77bcf86cd799439022";
const TOKEN = "tokenTokenToken1234";
const day = (iso: string, hhmmZ = "15:00:00") => new Date(`${iso}T${hhmmZ}Z`); // 15:00Z = 12:00 em São Paulo

describe("groupLinkLastDay / groupLinkOpen (prazo do link do plano que virou grupo)", () => {
	const base = { updatedAt: day("2026-11-01") };
	it("com data do evento: vale o dia INTEIRO do evento em São Paulo, o dia seguinte recusa", () => {
		const p = { ...base, eventDate: "2026-12-10" };
		expect(groupLinkLastDay(p)).toBe("2026-12-10");
		expect(groupLinkOpen(p, day("2026-12-09"))).toBe(true);
		// 23:59 em São Paulo do dia do evento = 02:59Z do dia seguinte
		expect(groupLinkOpen(p, new Date("2026-12-11T02:59:00Z"))).toBe(true);
		// 00:00 em São Paulo do dia seguinte = 03:00Z
		expect(groupLinkOpen(p, new Date("2026-12-11T03:00:00Z"))).toBe(false);
		expect(groupLinkOpen(p, day("2026-12-11"))).toBe(false);
	});
	it("sem data: 7 dias depois do fechamento (closedAt), contados no fuso de São Paulo", () => {
		const p = { ...base, closedAt: new Date("2026-11-02T01:00:00Z") }; // ainda 01/11 em São Paulo
		expect(GROUP_LINK_GRACE_DAYS).toBe(7);
		expect(groupLinkLastDay(p)).toBe("2026-11-08");
		expect(groupLinkOpen(p, new Date("2026-11-09T02:59:00Z"))).toBe(true);
		expect(groupLinkOpen(p, new Date("2026-11-09T03:00:00Z"))).toBe(false);
	});
	it("fechado DEPOIS do dia do evento: vale a regra de 7 dias a partir do fechamento", () => {
		const p = { updatedAt: day("2026-11-01"), eventDate: "2026-10-20", closedAt: day("2026-11-01") };
		expect(groupLinkLastDay(p)).toBe("2026-11-08");
		expect(groupLinkOpen(p, day("2026-11-08"))).toBe(true);
		expect(groupLinkOpen(p, day("2026-11-09"))).toBe(false);
	});
	it("fechado no próprio dia do evento: vale até o fim desse dia", () => {
		const p = { updatedAt: day("2026-11-01"), eventDate: "2026-11-01", closedAt: day("2026-11-01") };
		expect(groupLinkLastDay(p)).toBe("2026-11-01");
	});
	it("plano antigo sem closedAt usa updatedAt", () => {
		expect(groupLinkLastDay({ updatedAt: day("2026-11-01") })).toBe("2026-11-08");
	});
});

type Doc = Record<string, unknown>;
function world(planOver: Partial<PlanDoc> = {}, members: string[] = ["adm"], groupExists = true, groupOver: Doc = {}) {
	const plan: PlanDoc = {
		_id: new ObjectId(PID),
		name: "Hotel",
		totalCents: 90000,
		createdBy: "adm",
		status: "done",
		participants: [{ uid: "adm", joinedAt: new Date() }, { uid: "ana", joinedAt: new Date() }],
		guests: [],
		responses: [{ who: "ana", going: false, limitCents: 5000, by: "ana", at: new Date() }],
		attachments: [],
		invite: { token: TOKEN, expiresAt: new Date(Date.now() + 86_400_000) },
		groupId: GID,
		groupName: "Hotel",
		expenseId: "e1",
		eventDate: "2999-01-01",
		version: 3,
		createdAt: new Date(),
		updatedAt: new Date(),
		...planOver,
	};
	const group = { _id: new ObjectId(GID), name: "Viagem", members: members.map((uid, i) => ({ uid, role: i === 0 ? "admin" : "member", joinedAt: new Date() })), invite: null, ...groupOver } as { _id: ObjectId; name: string; members: { uid: string; role: string; joinedAt: Date }[]; invite: null; removedUids?: string[]; planLinkOff?: true };
	const planFindOne = async (q: Doc) => {
		const exp = (q["invite.expiresAt"] as { $gt: Date } | undefined)?.$gt;
		if (q["invite.token"] !== plan.invite?.token) return null;
		if (exp && !(plan.invite!.expiresAt > exp)) return null;
		return plan;
	};
	let planWrites = 0;
	const groupsCol = {
		findOne: async (q: Doc) => (!groupExists ? null : q["members.uid"] && !group.members.some((m) => m.uid === q["members.uid"]) ? null : group),
		findOneAndUpdate: async (q: Doc, u: { $push: { members: { uid: string; role: string; joinedAt: Date } } }) => {
			const uid = u.$push.members.uid;
			if (!groupExists || group.members.some((m) => m.uid === uid) || group.members.length >= MAX_MEMBERS) return null;
			if (group.removedUids?.includes(uid) || group.planLinkOff) return null;
			void q;
			group.members.push(u.$push.members);
			return { _id: group._id };
		},
	};
	const db = {
		collection: (name: string) =>
			name === "plans"
				? { findOne: planFindOne, findOneAndUpdate: async () => null, updateOne: async () => void planWrites++ }
				: name === "groups"
					? groupsCol
					: { find: () => ({ toArray: async () => [{ _id: "adm", name: "Rafael" }] }) },
	} as never;
	return { db, plan, group, planWrites: () => planWrites };
}

describe("previewPlanInvite com plano que virou grupo", () => {
	it("dentro do prazo: só nomes, sem valores, placar, limites, pessoas nem data", async () => {
		const w = world();
		const r = await previewPlanInvite(w.db, TOKEN, "novo");
		expect(r).toEqual({ closed: true, planName: "Hotel", groupName: "Viagem", creatorName: "Rafael", alreadyMember: false });
		const text = JSON.stringify(r);
		for (const leak of ["90000", "5000", "ana", "limit", "totalCents", "eventDate", GID, "e1"]) expect(text).not.toContain(leak);
	});
	it("quem já é membro recebe o groupId; quem não é, não", async () => {
		const w = world({}, ["adm", "mem"]);
		expect(await previewPlanInvite(w.db, TOKEN, "mem")).toMatchObject({ closed: true, alreadyMember: true, groupId: GID });
		expect(await previewPlanInvite(w.db, TOKEN, "novo")).not.toHaveProperty("groupId");
	});
	it("depois do prazo: só { gone }, sem nome do plano nem do grupo", async () => {
		const w = world({ eventDate: "2020-01-01", closedAt: new Date("2019-12-30T15:00:00Z") });
		expect(await previewPlanInvite(w.db, TOKEN, "novo")).toEqual({ gone: true });
	});
	it("convite de 90 dias vencido: indistinguível (null), mesmo com a data do evento no futuro", async () => {
		const w = world({ invite: { token: TOKEN, expiresAt: new Date(Date.now() - 1000) } });
		expect(await previewPlanInvite(w.db, TOKEN, "novo")).toBeNull();
	});
	it("plano cancelado ou em fechamento: null", async () => {
		expect(await previewPlanInvite(world({ status: "cancelled" }).db, TOKEN, "x")).toBeNull();
		expect(await previewPlanInvite(world({ status: "closing" }).db, TOKEN, "x")).toBeNull();
	});
	it("grupo apagado: null", async () => {
		expect(await previewPlanInvite(world({}, ["adm"], false).db, TOKEN, "x")).toBeNull();
	});
});

describe("acceptPlanInvite com plano que virou grupo", () => {
	it("qualquer pessoa entra no grupo como membro comum; o plano não muda e nenhuma despesa é tocada", async () => {
		const w = world();
		expect(await acceptPlanInvite(w.db, TOKEN, "novo")).toEqual({ status: "group", groupId: GID, joined: true });
		expect(w.group.members.find((m) => m.uid === "novo")).toMatchObject({ role: "member" });
		expect(w.plan.participants.map((p) => p.uid)).toEqual(["adm", "ana"]);
		expect(w.planWrites()).toBe(0);
	});
	it("quem disse 'Não vou' (e está no plano) entra", async () => {
		const w = world();
		expect(await acceptPlanInvite(w.db, TOKEN, "ana")).toMatchObject({ status: "group", joined: true });
	});
	it("idempotente: quem já é membro recebe o grupo sem joined; duas vezes não duplica", async () => {
		const w = world({}, ["adm", "mem"]);
		expect(await acceptPlanInvite(w.db, TOKEN, "mem")).toEqual({ status: "group", groupId: GID });
		await acceptPlanInvite(w.db, TOKEN, "novo");
		expect(await acceptPlanInvite(w.db, TOKEN, "novo")).toEqual({ status: "group", groupId: GID });
		expect(w.group.members.filter((m) => m.uid === "novo")).toHaveLength(1);
	});
	it("removido pelo criador continua barrado", async () => {
		const w = world({ removed: ["ana"] });
		expect(await acceptPlanInvite(w.db, TOKEN, "ana")).toEqual({ status: "removed" });
		expect(w.group.members.some((m) => m.uid === "ana")).toBe(false);
	});
	it("depois do prazo: gone, e não entra", async () => {
		const w = world({ eventDate: "2020-01-01", closedAt: new Date("2019-12-30T15:00:00Z") });
		expect(await acceptPlanInvite(w.db, TOKEN, "novo")).toEqual({ status: "gone" });
		expect(w.group.members.some((m) => m.uid === "novo")).toBe(false);
	});
	it("grupo cheio: group_full", async () => {
		const w = world({}, Array.from({ length: MAX_MEMBERS }, (_, i) => `u${i}`));
		expect(await acceptPlanInvite(w.db, TOKEN, "novo")).toEqual({ status: "group_full" });
	});
	it("cancelado ou fechando: invalid", async () => {
		expect(await acceptPlanInvite(world({ status: "cancelled" }).db, TOKEN, "novo")).toEqual({ status: "invalid" });
		expect(await acceptPlanInvite(world({ status: "closing" }).db, TOKEN, "novo")).toEqual({ status: "invalid" });
	});
	it("convite vencido: invalid", async () => {
		const w = world({ invite: { token: TOKEN, expiresAt: new Date(Date.now() - 1000) } });
		expect(await acceptPlanInvite(w.db, TOKEN, "novo")).toEqual({ status: "invalid" });
	});
});

describe("grupo: removido pelo administrador e link do grupo girado", () => {
	it("expulso do grupo tenta pelo link do plano: group_removed e não entra; a prévia não dá groupId", async () => {
		const w = world({}, ["adm"], true, { removedUids: ["exp"] });
		expect(await acceptPlanInvite(w.db, TOKEN, "exp")).toEqual({ status: "group_removed" });
		expect(w.group.members.some((m) => m.uid === "exp")).toBe(false);
		expect(await previewPlanInvite(w.db, TOKEN, "exp")).not.toHaveProperty("groupId");
	});
	it("padrão (sem bloqueio): quem foi removido sem desmarcar volta pelo link do plano e fica membro comum", async () => {
		const w = world({}, ["adm"], true, { removedUids: [] });
		expect(await acceptPlanInvite(w.db, TOKEN, "exp")).toEqual({ status: "group", groupId: GID, joined: true });
	});
	it("link do grupo girado (planLinkOff): prévia e aceite respondem como vencido", async () => {
		const w = world({}, ["adm"], true, { planLinkOff: true });
		expect(await previewPlanInvite(w.db, TOKEN, "novo")).toEqual({ gone: true });
		expect(await acceptPlanInvite(w.db, TOKEN, "novo")).toEqual({ status: "gone" });
		expect(w.group.members.some((m) => m.uid === "novo")).toBe(false);
	});
	it("quem está em plan.removed mas já é membro do grupo recebe ok; fora do grupo continua barrado", async () => {
		const w = world({ removed: ["mem", "fora"] }, ["adm", "mem"]);
		expect(await acceptPlanInvite(w.db, TOKEN, "mem")).toEqual({ status: "group", groupId: GID });
		expect(await acceptPlanInvite(w.db, TOKEN, "fora")).toEqual({ status: "removed" });
	});
	it("a prévia de quem está em plan.removed e fora do grupo segue igual (tela normal, sem groupId)", async () => {
		const w = world({ removed: ["fora"] });
		expect(await previewPlanInvite(w.db, TOKEN, "fora")).toMatchObject({ closed: true, alreadyMember: false });
	});
});
