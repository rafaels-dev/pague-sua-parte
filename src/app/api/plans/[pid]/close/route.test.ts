import { beforeEach, describe, expect, it, vi } from "vitest";

const closePlan = vi.fn();
const afterPlanConfirmed = vi.fn();
const afterPlanClosed = vi.fn();

vi.mock("@/lib/auth/server", () => ({ requireUser: async () => ({ uid: "cri" }) }));
vi.mock("@/lib/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => ({}) }));
vi.mock("@/lib/plans/close", () => ({ closePlan: (...a: unknown[]) => closePlan(...a) }));
vi.mock("@/lib/notifications/events", () => ({
	afterPlanConfirmed: (...a: unknown[]) => afterPlanConfirmed(...a),
	afterPlanClosed: (...a: unknown[]) => afterPlanClosed(...a),
}));

import { POST } from "./route";

const doc = { _id: { toHexString: () => "p1" }, name: "Sítio", groupName: "Sítio", createdBy: "cri", participants: [], guests: [], responses: [] };
const call = () => POST(new Request("http://x/api/plans/p1/close", { method: "POST", body: "{}" }), { params: Promise.resolve({ pid: "p1" }) });

describe("POST /api/plans/[pid]/close", () => {
	beforeEach(() => vi.clearAllMocks());

	it("com despesa: devolve groupId e expenseId e avisa 'Plano confirmado' e 'Nova despesa'", async () => {
		const fact = { groupId: "g1", expenseId: "e1" };
		closePlan.mockResolvedValue({ status: "ok", groupId: "g1", expenseId: "e1", doc, newExpense: fact, notChosenGoing: ["x"] });
		const res = await call();
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ groupId: "g1", expenseId: "e1" });
		expect(afterPlanConfirmed).toHaveBeenCalledWith({ planName: "Sítio", groupName: "Sítio", groupId: "g1", actorUid: "cri" }, fact);
		expect(afterPlanClosed).toHaveBeenCalledOnce();
	});

	it("só o grupo: sem expenseId na resposta, 'Plano confirmado' sai e 'Nova despesa' não", async () => {
		closePlan.mockResolvedValue({ status: "ok", groupId: "g1", doc, notChosenGoing: ["x"] });
		const res = await call();
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ groupId: "g1" });
		expect(afterPlanConfirmed).toHaveBeenCalledOnce();
		expect(afterPlanConfirmed.mock.calls[0][1]).toBeUndefined();
		// "fechado sem você" continua igual
		expect(afterPlanClosed.mock.calls[0][0]).toMatchObject({ leftOutIds: ["x"] });
	});

	it("422 de createExpense inválido volta com o campo", async () => {
		closePlan.mockResolvedValue({ status: "invalid", field: "createExpense", error: "Escolha se a despesa será lançada." });
		const res = await call();
		expect(res.status).toBe(422);
		expect(afterPlanConfirmed).not.toHaveBeenCalled();
	});
});
