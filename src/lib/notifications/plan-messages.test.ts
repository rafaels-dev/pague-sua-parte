import { describe, expect, it } from "vitest";
import { buildPlanCancelledNotices, buildPlanChangeNotices, buildPlanClosedNotices, planLoginOf } from "./plan-messages";
import type { PlanChangeFact, PlanNoticeBase, PlanSnapshot } from "./types";

const base: PlanNoticeBase = {
	planId: "p1",
	name: "Hotel",
	actorUid: "ana",
	creatorUid: "cri",
	participants: ["cri", "ana", "bia"],
	guests: [{ id: "pg_1", name: "Benjamim", addedBy: "bia" }],
};
const snap = (o: Partial<PlanSnapshot> = {}): PlanSnapshot => ({ fits: false, shareCents: null, includedUids: [], aboveLimitUids: [], shareIfIncluded: {}, ...o });
const change = (o: Partial<PlanChangeFact>): PlanChangeFact => ({ ...base, before: snap(), after: snap(), limits: {}, ...o });

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
	it("passou a ficar acima do limite: só ela, com o limite dela", () => {
		const n = buildPlanChangeNotices(
			change({
				actorUid: "cri",
				before: snap({ fits: true, shareCents: 25000, includedUids: ["cri", "ana"] }),
				after: snap({ fits: true, shareCents: 25000, includedUids: ["cri", "ana"], aboveLimitUids: ["ana"], shareIfIncluded: { ana: 27778 } }),
				limits: { ana: 25000, cri: 99999 },
			}),
		);
		expect(n).toEqual([
			{ uid: "ana", title: "Passou do seu limite", body: '"Hotel" ficou em R$ 277,78 para cada um, acima do seu limite de R$ 250,00. Você vai ou não?', url: "/app/planos/p1" },
		]);
	});
	it("quem já estava acima do limite não é avisado de novo", () => {
		const s = snap({ aboveLimitUids: ["ana"], shareIfIncluded: { ana: 100 } });
		expect(buildPlanChangeNotices(change({ actorUid: "cri", before: s, after: s, limits: { ana: 50 } }))).toEqual([]);
	});
	it("nunca avisa quem fez a ação (nem do próprio limite)", () => {
		const n = buildPlanChangeNotices(change({ actorUid: "ana", after: snap({ aboveLimitUids: ["ana"], shareIfIncluded: { ana: 100 } }), limits: { ana: 50 } }));
		expect(n).toEqual([]);
	});
	it("pessoa sem celular acima do limite: avisa quem a acrescentou, com o nome", () => {
		const [n, ...rest] = buildPlanChangeNotices(change({ after: snap({ aboveLimitUids: ["pg_1"], shareIfIncluded: { pg_1: 30000 } }), limits: { pg_1: 20000 } }));
		expect(rest).toEqual([]);
		expect(n.uid).toBe("bia");
		expect(n.body).toBe('"Hotel" ficou em R$ 300,00 para cada um, acima do limite de Benjamim (R$ 200,00). Benjamim vai ou não?');
	});
	it("o limite de uma pessoa nunca aparece no aviso de outra", () => {
		const n = buildPlanChangeNotices(
			change({
				before: snap(),
				after: snap({ fits: true, shareCents: 25000, includedUids: ["cri", "bia"], aboveLimitUids: ["ana"], shareIfIncluded: { ana: 27778 } }),
				limits: { ana: 12345, bia: 54321 },
			}),
		);
		for (const x of n.filter((y) => y.uid !== "ana")) expect(x.body).not.toMatch(/123,45|543,21/);
		expect(n.find((x) => x.uid === "ana")).toBeUndefined(); // ana é quem agiu
	});
	it("sem limite conhecido, não inventa aviso", () => {
		expect(buildPlanChangeNotices(change({ actorUid: "cri", after: snap({ aboveLimitUids: ["ana"], shareIfIncluded: { ana: 100 } }) }))).toEqual([]);
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
