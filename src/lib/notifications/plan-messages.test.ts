import { describe, expect, it } from "vitest";
import { buildPlanCancelledNotices, buildPlanChangeNotices, buildPlanClosedNotices, buildPlanConfirmedNotices, planLoginOf } from "./plan-messages";
import type { NoticeContext, PlanChangeFact, PlanNoticeBase, PlanSnapshot } from "./types";

const base: PlanNoticeBase = {
	planId: "p1",
	name: "Hotel",
	totalCents: 250000,
	actorUid: "ana",
	creatorUid: "cri",
	participants: ["cri", "ana", "bia"],
	guests: [{ id: "pg_1", name: "Benjamim", addedBy: "bia" }],
};
const snap = (o: Partial<PlanSnapshot> = {}): PlanSnapshot => ({ fits: false, shareCents: null, includedUids: [], ...o });
const change = (o: Partial<PlanChangeFact>): PlanChangeFact => ({ ...base, before: snap(), after: snap(), ...o });

describe("planLoginOf", () => {
	it("participante é ele mesmo; pessoa sem celular vira quem a acrescentou; fora do plano, ninguém", () => {
		expect(planLoginOf(base, "ana")).toBe("ana");
		expect(planLoginOf(base, "pg_1")).toBe("bia");
		expect(planLoginOf(base, "fora")).toBeNull();
		expect(planLoginOf({ ...base, participants: ["cri", "ana"] }, "pg_1")).toBeNull();
	});
});

describe("avisos de mudança", () => {
	it("não fecha -> fecha: criador e incluídos, sem quem fez a ação, sem repetir", () => {
		const n = buildPlanChangeNotices(change({ after: snap({ fits: true, shareCents: 27778, includedUids: ["cri", "ana", "pg_1", "bia"] }) }));
		expect(n.map((x) => x.uid).sort()).toEqual(["bia", "cri"]);
		expect(n[0]).toMatchObject({ title: "O plano fecha", body: 'O plano "Hotel" agora fecha: R$ 277,78 para cada um.', url: "/app/planos/p1" });
	});
	it("já fechava antes: nenhum aviso", () => {
		const s = snap({ fits: true, shareCents: 100, includedUids: ["cri"] });
		expect(buildPlanChangeNotices(change({ before: s, after: { ...s, shareCents: 90 } }))).toEqual([]);
	});
	it("nunca avisa quem fez a ação", () => {
		const n = buildPlanChangeNotices(change({ actorUid: "ana", after: snap({ fits: true, shareCents: 25000, includedUids: ["cri", "ana"] }) }));
		expect(n.map((x) => x.uid)).toEqual(["cri"]);
	});
	it("não existe mais aviso de limite: ficar acima do limite não gera nada", () => {
		const s = snap({ fits: true, shareCents: 25000, includedUids: ["cri", "ana"] });
		expect(buildPlanChangeNotices(change({ actorUid: "cri", before: s, after: s }))).toEqual([]);
	});
});

describe("plano cancelado e fechado", () => {
	it("cancelado: quem tinha dito Vou, menos quem cancelou, quem cuida recebe pelas pessoas sem celular (uma vez)", () => {
		const n = buildPlanCancelledNotices({ ...base, actorUid: "cri", goingIds: ["cri", "ana", "bia", "pg_1"] });
		expect(n.map((x) => x.uid).sort()).toEqual(["ana", "bia"]);
		expect(n[0]).toMatchObject({ title: "Plano cancelado", body: 'O plano "Hotel" foi cancelado.' });
		expect(n.filter((x) => x.uid === "bia")).toHaveLength(1);
	});
	it("fechado sem você", () => {
		const n = buildPlanClosedNotices({ ...base, actorUid: "cri", leftOutIds: ["bia", "pg_1", "cri"] });
		expect(n.map((x) => x.body).sort()).toEqual(['O plano "Hotel" foi fechado sem Benjamim.', 'O plano "Hotel" foi fechado sem você.']);
		expect(n.every((x) => x.uid === "bia")).toBe(true);
	});
	it("nome longo é cortado", () => {
		const n = buildPlanCancelledNotices({ ...base, name: "x".repeat(100), actorUid: "cri", goingIds: ["ana"] });
		expect(n[0].body.length).toBeLessThan(90);
	});
});

describe("plano confirmado (grupo criado)", () => {
	const members = [
		{ uid: "cri", role: "admin" as const },
		{ uid: "ana", role: "member" as const },
		{ uid: "bia", role: "member" as const },
		{ uid: "m_ben", role: "member" as const, kind: "managed" as const, managedBy: "bia" },
	];
	const ctx: NoticeContext = { group: (id) => (id === "g1" ? { name: "Hotel", members } : undefined), name: (_g, u) => u };
	const fact = { planName: "Hotel", groupName: "Hotel de verão", groupId: "g1", actorUid: "cri" };
	it("todas as pessoas com login do grupo, menos quem fechou; um aviso por pessoa; sem valor", () => {
		const n = buildPlanConfirmedNotices(fact, ctx);
		expect(n.map((x) => x.uid).sort()).toEqual(["ana", "bia"]);
		expect(n[0]).toEqual({
			uid: "ana",
			title: "Plano confirmado",
			subject: 'Plano confirmado: "Hotel"',
			body: 'O plano "Hotel" está confirmado e o grupo "Hotel de verão" foi criado. Você já está no grupo.',
			url: "/app/grupos/g1",
			scope: { kind: "group", name: "Hotel de verão" },
		});
	});
	it("grupo desconhecido: nenhum aviso", () => expect(buildPlanConfirmedNotices({ ...fact, groupId: "outro" }, ctx)).toEqual([]));
	it("serve aos dois modos: não afirma que uma despesa foi lançada (o plano pode virar só o grupo)", () => {
		for (const n of buildPlanConfirmedNotices(fact, ctx)) expect(`${n.title} ${n.subject} ${n.body}`).not.toMatch(/despesa|dividi|R\$/i);
		const closed = buildPlanClosedNotices({ ...base, actorUid: "cri", leftOutIds: ["ana"] });
		expect(closed).toHaveLength(1);
		expect(`${closed[0].title} ${closed[0].subject} ${closed[0].body}`).not.toMatch(/despesa|dividi|R\$/i);
	});
});
