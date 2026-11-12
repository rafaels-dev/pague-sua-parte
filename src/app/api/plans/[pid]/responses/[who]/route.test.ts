import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const setResponse = vi.fn();
const getPlanView = vi.fn();
vi.mock("@/lib/plans/repo", () => ({ setResponse, getPlanView }));
const afterPlanChange = vi.fn();
vi.mock("@/lib/notifications/events", () => ({ afterPlanChange }));

const { PUT } = await import("./route");
const ctx = { params: Promise.resolve({ pid: "507f1f77bcf86cd799439011", who: "u1" }) };
const put = (body: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }), ctx);
const doc = (over = {}) => ({ _id: { toHexString: () => "p1" }, name: "Hotel", totalCents: 1000, createdBy: "c", participants: [{ uid: "c" }, { uid: "u1" }], guests: [], responses: [], ...over });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
	getPlanView.mockResolvedValue({ id: "p1" });
});

describe("PUT /api/plans/:pid/responses/:who", () => {
	it("grava a resposta e avisa pelas transições", async () => {
		setResponse.mockResolvedValue({ kind: "ok", view: { id: "p1" }, before: doc(), doc: doc({ responses: [{ who: "u1", going: true, by: "u1", at: new Date() }] }) });
		const res = await put({ going: true, limitCents: 5000 });
		expect(res.status).toBe(200);
		expect(setResponse).toHaveBeenCalledWith({ fake: true }, "507f1f77bcf86cd799439011", "u1", "u1", { going: true, limitCents: 5000 });
		expect(afterPlanChange).toHaveBeenCalledTimes(1);
		expect(afterPlanChange.mock.calls[0][0]).toMatchObject({ actorUid: "u1", name: "Hotel" });
	});
	it("limite inválido: 422 e nada é gravado", async () => {
		const res = await put({ going: true, limitCents: -5 });
		expect(res.status).toBe(422);
		expect((await res.json()).field).toBe("limitCents");
		expect(setResponse).not.toHaveBeenCalled();
	});
	it("quem não participa do plano recebe 404, mesmo com corpo inválido", async () => {
		getPlanView.mockResolvedValue(null);
		expect((await put({ going: "talvez" })).status).toBe(404);
	});
	it("responder por quem não é seu: 403, sem aviso", async () => {
		setResponse.mockResolvedValue({ kind: "forbidden" });
		expect((await put({ going: false })).status).toBe(403);
		expect(afterPlanChange).not.toHaveBeenCalled();
	});
	it("plano fechado: 409", async () => {
		setResponse.mockResolvedValue({ kind: "closed" });
		expect((await put({ going: false })).status).toBe(409);
	});
	it("sem login: 401", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await put({ going: false })).status).toBe(401);
	});
});
