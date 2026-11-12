import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { AttachmentStore } from "@/lib/storage/attachments";
import { CLOSING_STALE_MS, type PlanDoc } from "./collection";
import { acceptPlanInvite, cancelPlan, getPlanView, listPlans, removeParticipant, setResponse } from "./repo";
import { fakeDb } from "./test-db";

const NOW = new Date();
const PID = "507f1f77bcf86cd799439011";
const TOKEN = "tokenTokenToken1234";

function plan(over: Partial<PlanDoc> = {}): PlanDoc {
	return {
		_id: new ObjectId(PID),
		name: "Hotel",
		totalCents: 90000,
		createdBy: "cri",
		status: "open",
		participants: [{ uid: "cri", joinedAt: NOW }, { uid: "ana", joinedAt: NOW }],
		guests: [{ id: "pg_1", name: "Benjamim", addedBy: "ana" }],
		responses: [{ who: "ana", going: true, by: "ana", at: NOW }, { who: "pg_1", going: true, by: "ana", at: NOW }],
		attachments: [],
		invite: { token: TOKEN, expiresAt: new Date(NOW.getTime() + 86_400_000) },
		version: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	};
}
const setup = (over: Partial<PlanDoc> = {}) => {
	const f = fakeDb();
	f.data.plans.push(plan(over) as never);
	return f;
};

describe("quem o criador tirou não volta pelo link (S2)", () => {
	it("tirado pelo criador: entra em `removed` e o aceite é recusado", async () => {
		const f = setup();
		const res = await removeParticipant(f.db, PID, "cri", "ana");
		expect(res.kind).toBe("ok");
		expect(f.data.plans[0].removed).toEqual(["ana"]);
		// as pessoas sem celular dele saem junto
		expect((f.data.plans[0].guests as unknown[]).length).toBe(0);
		expect(await acceptPlanInvite(f.db, TOKEN, "ana")).toEqual({ status: "removed" });
		expect((f.data.plans[0].participants as { uid: string }[]).map((p) => p.uid)).toEqual(["cri"]);
	});
	it("quem saiu por conta própria pode voltar", async () => {
		const f = setup();
		expect((await removeParticipant(f.db, PID, "ana", "ana")).kind).toBe("ok");
		expect(f.data.plans[0].removed).toBeUndefined();
		expect(await acceptPlanInvite(f.db, TOKEN, "ana")).toMatchObject({ status: "ok", joined: true });
	});
	it("outra pessoa continua entrando; o criador não sai nem é tirado", async () => {
		const f = setup();
		await removeParticipant(f.db, PID, "cri", "ana");
		expect(await acceptPlanInvite(f.db, TOKEN, "novo")).toMatchObject({ status: "ok", joined: true });
		expect((await removeParticipant(f.db, PID, "cri", "cri")).kind).toBe("forbidden");
		expect((await removeParticipant(f.db, PID, "novo", "cri")).kind).toBe("forbidden");
	});
	it("quem entrou e é tirado de novo continua na lista de removidos sem repetir", async () => {
		const f = setup({ removed: ["ana"], participants: [{ uid: "cri", joinedAt: NOW }, { uid: "ana", joinedAt: NOW }] });
		await removeParticipant(f.db, PID, "cri", "ana");
		expect(f.data.plans[0].removed).toEqual(["ana"]);
	});
});

describe("cancelar apaga as fotos", () => {
	it("apaga os objetos e esvazia a lista; só o criador cancela", async () => {
		const f = setup({ attachments: [{ id: "a1", key: "plans/x/a1", name: "a.jpg", contentType: "image/jpeg", size: 1 }] });
		const del = vi.fn(async () => {});
		const store = { delete: del } as unknown as AttachmentStore;
		expect((await cancelPlan(f.db, store, PID, "ana")).kind).toBe("forbidden");
		expect(del).not.toHaveBeenCalled();
		const res = await cancelPlan(f.db, store, PID, "cri");
		expect(res.kind).toBe("ok");
		expect(del).toHaveBeenCalledWith(["plans/x/a1"]);
		expect(f.data.plans[0]).toMatchObject({ status: "cancelled", attachments: [], invite: null });
		expect(res.kind === "ok" && res.view.attachments).toEqual([]);
	});
});

describe("fechamento preso é desfeito na leitura (1)", () => {
	const stuck = () => {
		const gid = new ObjectId();
		const eid = new ObjectId();
		const f = setup({ status: "closing", closing: { at: new Date(NOW.getTime() - CLOSING_STALE_MS - 5000), attemptId: "velha", groupId: gid.toHexString(), expenseId: eid.toHexString() } });
		f.data.groups.push({ _id: gid });
		f.data.expenses.push({ _id: eid, planId: PID });
		return f;
	};
	it("getPlanView devolve o plano aberto e apaga as sobras", async () => {
		const f = stuck();
		const view = await getPlanView(f.db, PID, "ana");
		expect(view?.status).toBe("open");
		expect(f.data.groups).toHaveLength(0);
		expect(f.data.expenses).toHaveLength(0);
		expect(f.data.plans[0].closing).toBeUndefined();
	});
	it("listPlans mostra o plano em andamento", async () => {
		const f = stuck();
		const list = await listPlans(f.db, "ana", "open");
		expect(list.map((p) => [p.id, p.status])).toEqual([[PID, "open"]]);
		expect(f.data.groups).toHaveLength(0);
	});
	it("fechamento recente continua closing", async () => {
		const f = setup({ status: "closing", closing: { at: NOW, attemptId: "viva", groupId: new ObjectId().toHexString(), expenseId: new ObjectId().toHexString() } });
		expect((await getPlanView(f.db, PID, "ana"))?.status).toBe("closing");
	});
});

describe("respostas", () => {
	it("pessoa sem celular responde pela mensagem de quem a acrescentou; os outros não", async () => {
		const f = setup();
		expect((await setResponse(f.db, PID, "ana", "pg_1", { going: false })).kind).toBe("ok");
		expect((await setResponse(f.db, PID, "cri", "pg_1", { going: false })).kind).toBe("forbidden");
		expect((await setResponse(f.db, PID, "cri", "ana", { going: false })).kind).toBe("forbidden");
	});
	it("'Vou mesmo assim' grava o limite calculado no servidor, não o do cliente", async () => {
		const f = setup({ responses: [{ who: "cri", going: true, by: "cri", at: NOW }, { who: "ana", going: true, limitCents: 1000, by: "ana", at: NOW }] });
		const res = await setResponse(f.db, PID, "ana", "ana", { going: true, sameAsShare: true });
		expect(res.kind).toBe("ok");
		const saved = (f.data.plans[0].responses as { who: string; limitCents?: number }[]).find((r) => r.who === "ana")!;
		expect(saved.limitCents).toBeGreaterThan(1000);
	});
});

describe("'Ver o plano' na despesa (6)", () => {
	it("o código do plano só vai para quem participa dele", async () => {
		const { visiblePlanId } = await import("@/lib/expenses/repo");
		const f = setup();
		expect(await visiblePlanId(f.db, PID, "ana")).toBe(PID);
		expect(await visiblePlanId(f.db, PID, "intruso")).toBeNull();
		expect(await visiblePlanId(f.db, undefined, "ana")).toBeNull();
		expect(await visiblePlanId(f.db, "lixo", "ana")).toBeNull();
	});
});
