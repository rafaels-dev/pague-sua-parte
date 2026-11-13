import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { PlanDoc } from "./collection";
import { buildPlanSummary, buildPlanView, canAnswerFor, canSeeLimit } from "./view";

const NOW = new Date("2026-11-12T12:00:00Z");
const info = (uid: string) => ({ name: { cri: "Carla", ana: "Ana", bia: "Bia", dan: "Dan" }[uid] ?? "Alguém", picture: null });

function plan(over: Partial<PlanDoc> = {}): PlanDoc {
	return {
		_id: new ObjectId("507f1f77bcf86cd799439011"),
		name: "Hotel",
		totalCents: 90000,
		createdBy: "cri",
		status: "open",
		participants: [
			{ uid: "cri", joinedAt: NOW },
			{ uid: "ana", joinedAt: NOW },
			{ uid: "bia", joinedAt: NOW },
		],
		guests: [{ id: "pg_1", name: "Benjamim", addedBy: "ana" }],
		responses: [
			{ who: "cri", going: true, by: "cri", at: NOW },
			{ who: "ana", going: true, limitCents: 10000, by: "ana", at: NOW },
			{ who: "pg_1", going: true, limitCents: 12000, by: "ana", at: NOW },
		],
		attachments: [],
		invite: null,
		version: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	};
}
const person = (v: ReturnType<typeof buildPlanView>, id: string) => v.people.find((p) => p.id === id)!;

describe("privacidade do limite", () => {
	it("canSeeLimit: a pessoa, quem a acrescentou e o criador", () => {
		const p = plan();
		expect(canSeeLimit(p, "ana", "ana")).toBe(true);
		expect(canSeeLimit(p, "ana", "pg_1")).toBe(true);
		expect(canSeeLimit(p, "cri", "ana")).toBe(true);
		expect(canSeeLimit(p, "bia", "ana")).toBe(false);
		expect(canSeeLimit(p, "bia", "pg_1")).toBe(false);
		expect(canSeeLimit(p, "ana", "bia")).toBe(false);
	});
	it("outro participante não recebe limite, nem 'acima do limite', nem a parte que seria", () => {
		const v = buildPlanView(plan(), "bia", info);
		for (const p of v.people.filter((x) => !x.isYou)) expect([p.limitCents, p.aboveLimit, p.shareIfIncludedCents]).toEqual([null, null, null]);
		expect(JSON.stringify(v)).not.toContain("10000");
		expect(JSON.stringify(v)).not.toContain("12000");
	});
	it("o criador vê o limite de todos", () => {
		const v = buildPlanView(plan(), "cri", info);
		expect(person(v, "ana").limitCents).toBe(10000);
		expect(person(v, "pg_1").limitCents).toBe(12000);
	});
	it("quem acrescentou vê o limite da sua pessoa, e a própria pessoa o seu", () => {
		const v = buildPlanView(plan(), "ana", info);
		expect(person(v, "ana").limitCents).toBe(10000);
		expect(person(v, "pg_1").limitCents).toBe(12000);
		expect(person(v, "bia").limitCents).toBeNull();
		expect(person(v, "cri").limitCents).toBeNull();
	});
	it("quem está acima do limite sabe, com a parte que seria; os outros não", () => {
		// total 900, 3 vão: parte 300 > 100 e 120 -> só o criador cabe? cri sem limite: k=1 -> 900
		const p = plan();
		const v = buildPlanView(p, "ana", info);
		expect(v.result.fits).toBe(true);
		expect(person(v, "ana").aboveLimit).toBe(true);
		expect(person(v, "ana").shareIfIncludedCents).toBeGreaterThan(10000);
		const other = buildPlanView(p, "bia", info);
		expect(person(other, "ana").aboveLimit).toBeNull();
	});
	it("o resultado não traz quem entrou, só a contagem; só o criador recebe os ids", () => {
		const p = plan();
		expect(buildPlanView(p, "bia", info).includedIds).toBeNull();
		expect(buildPlanView(p, "ana", info).goingIds).toBeNull();
		expect(buildPlanView(p, "cri", info).includedIds).toEqual(["cri"]);
		expect(buildPlanView(p, "bia", info).result.includedCount).toBe(1);
	});
	it("o resumo da lista nunca traz limite", () => {
		const s = buildPlanSummary(plan(), "bia");
		expect(JSON.stringify(s)).not.toMatch(/limit/i);
	});
});

describe("prévia da parte e removidos", () => {
	it("a prévia só vai para quem responde pela pessoa", () => {
		const v = buildPlanView(plan({ expectedPeople: 10 }), "bia", info);
		expect(person(v, "bia").preview).toEqual({ cents: 9000, basis: "expected", people: 10 });
		expect(person(v, "ana").preview).toBeNull();
		expect(person(v, "pg_1").preview).toBeNull();
		const ana = buildPlanView(plan({ expectedPeople: 10 }), "ana", info);
		expect(person(ana, "pg_1").preview).not.toBeNull(); // ana acrescentou o Benjamim
	});
	it("plano fechado não traz prévia", () => {
		const v = buildPlanView(plan({ status: "cancelled" }), "bia", info);
		expect(person(v, "bia").preview).toBeNull();
	});
	it("removidos só para o criador, com o plano aberto", () => {
		const p = plan({ removed: ["zeca"] });
		const named = (uid: string) => ({ name: uid === "zeca" ? "Zeca" : "x", picture: null });
		expect(buildPlanView(p, "cri", named).removed).toEqual([{ uid: "zeca", name: "Zeca" }]);
		expect(buildPlanView(p, "ana", named).removed).toEqual([]);
		expect(buildPlanView(plan({ removed: ["zeca"], status: "cancelled" }), "cri", named).removed).toEqual([]);
		expect(JSON.stringify(buildPlanView(p, "ana", named))).not.toContain("zeca");
	});
});

describe("respostas e permissões", () => {
	it("canAnswerFor", () => {
		const p = plan();
		expect(canAnswerFor(p, "ana", "pg_1")).toBe(true);
		expect(canAnswerFor(p, "bia", "pg_1")).toBe(false);
		expect(canAnswerFor(p, "cri", "ana")).toBe(false);
	});
	it("estado de cada pessoa e contagens", () => {
		const v = buildPlanView(plan(), "bia", info);
		expect(v.people.map((p) => [p.id, p.answer])).toEqual([["cri", "going"], ["ana", "going"], ["bia", "pending"], ["pg_1", "going"]]);
		expect(v.result).toMatchObject({ goingCount: 3, pendingCount: 1, notGoingCount: 0, peopleCount: 4, shareIfAllCents: 22500 });
		expect(v.people.find((p) => p.id === "pg_1")).toMatchObject({ youAnswer: false, addedByName: "Ana" });
	});
	it("needsMyAnswer inclui as pessoas por quem respondo", () => {
		const p = plan({ responses: plan().responses.filter((r) => r.who !== "pg_1") });
		expect(buildPlanSummary(p, "ana").needsMyAnswer).toBe(true);
		expect(buildPlanSummary(plan(), "ana").needsMyAnswer).toBe(false);
		expect(buildPlanSummary(plan(), "bia").needsMyAnswer).toBe(true);
	});
	it("quem pode remover quem", () => {
		const open = (c: string) => buildPlanView(plan(), c, info);
		expect(person(open("cri"), "ana").canRemove).toBe(true);
		expect(person(open("cri"), "cri").canRemove).toBe(false);
		expect(person(open("ana"), "ana").canRemove).toBe(true);
		expect(person(open("ana"), "pg_1").canRemove).toBe(true);
		expect(person(open("bia"), "pg_1").canRemove).toBe(false);
		expect(person(open("bia"), "ana").canRemove).toBe(false);
		expect(person(buildPlanView(plan({ status: "done" }), "cri", info), "ana").canRemove).toBe(false);
	});
	it("só o criador edita e fecha, e só com o plano aberto", () => {
		expect(buildPlanView(plan(), "cri", info)).toMatchObject({ canEdit: true, canClose: true, isCreator: true });
		expect(buildPlanView(plan(), "ana", info)).toMatchObject({ canEdit: false, canClose: false });
		expect(buildPlanView(plan({ status: "cancelled" }), "cri", info)).toMatchObject({ canEdit: false, canClose: false, open: false });
	});
	it("limite de pessoas sem celular por participante", () => {
		const guests = Array.from({ length: 5 }, (_, i) => ({ id: `pg_${i}`, name: `G${i}`, addedBy: "ana" }));
		expect(buildPlanView(plan({ guests }), "ana", info).canAddGuest).toBe(false);
		expect(buildPlanView(plan({ guests }), "bia", info).canAddGuest).toBe(true);
	});
	it("plano fechado: link do grupo só para quem entrou nele", () => {
		const done = plan({ status: "done", groupName: "Hotel", expenseId: "507f1f77bcf86cd799439012" });
		expect(buildPlanView(done, "ana", info, { groupId: "g1" }).closed).toEqual({ groupName: "Hotel", groupId: "g1", expenseId: "507f1f77bcf86cd799439012", hasExpense: true });
		expect(buildPlanView(done, "bia", info, { groupId: null }).closed).toEqual({ groupName: "Hotel", groupId: null, expenseId: null, hasExpense: true });
	});
	it("plano fechado só com o grupo: sem despesa na visão e no resumo", () => {
		const done = plan({ status: "done", groupName: "Sítio" });
		expect(buildPlanView(done, "ana", info, { groupId: "g1" }).closed).toEqual({ groupName: "Sítio", groupId: "g1", expenseId: null, hasExpense: false });
		expect(buildPlanSummary(done, "ana").hasExpense).toBe(false);
		expect(buildPlanSummary(plan({ status: "done", expenseId: "507f1f77bcf86cd799439012" }), "ana").hasExpense).toBe(true);
	});
	it("quantas pessoas previstas: placar, faltantes e parte de todos", () => {
		const v = buildPlanView(plan({ expectedPeople: 10 }), "bia", info);
		expect(v.result).toMatchObject({ expectedPeople: 10, allCount: 10, shareIfAllCents: 9000, answeredCount: 3, missingCount: 7 });
		// sem previsão: usa as pessoas do plano
		expect(buildPlanView(plan(), "bia", info).result).toMatchObject({ expectedPeople: null, allCount: 4, shareIfAllCents: 22500, missingCount: 1 });
		// mais gente do que o previsto: usa o número real, nunca negativo
		expect(buildPlanView(plan({ expectedPeople: 2 }), "bia", info).result).toMatchObject({ allCount: 4, missingCount: 1 });
		expect(buildPlanView(plan({ expectedPeople: 2, responses: [] }), "bia", info).result.missingCount).toBe(4);
	});
	it("a conta de quem fecha não usa a previsão", () => {
		const a = buildPlanView(plan({ expectedPeople: 200 }), "cri", info).result;
		const b = buildPlanView(plan(), "cri", info).result;
		expect([a.fits, a.shareCents, a.includedCount]).toEqual([b.fits, b.shareCents, b.includedCount]);
	});
	it("quem saiu do plano não conta (resposta ignorada)", () => {
		const p = plan({ participants: plan().participants.filter((x) => x.uid !== "ana"), guests: [], responses: plan().responses });
		const v = buildPlanView(p, "cri", info);
		expect(v.result.goingCount).toBe(1);
		expect(v.people.map((x) => x.id)).toEqual(["cri", "bia"]);
	});
});
