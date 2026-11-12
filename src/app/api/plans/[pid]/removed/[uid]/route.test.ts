import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const allowReturn = vi.fn();
vi.mock("@/lib/plans/repo", () => ({ allowReturn }));

const { DELETE } = await import("./route");
const call = () => DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ pid: "p1", uid: "zeca" }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "cri" });
});

describe("DELETE /api/plans/:pid/removed/:uid", () => {
	it("criador: 200 com a visão do plano", async () => {
		allowReturn.mockResolvedValue({ kind: "ok", view: { id: "p1" } });
		const res = await call();
		expect(res.status).toBe(200);
		expect(allowReturn).toHaveBeenCalledWith({ fake: true }, "p1", "cri", "zeca");
	});
	it("quem não criou: 403; plano fechado: 409; sem acesso: 404; sem login: 401", async () => {
		allowReturn.mockResolvedValue({ kind: "forbidden" });
		expect((await call()).status).toBe(403);
		allowReturn.mockResolvedValue({ kind: "closed" });
		expect((await call()).status).toBe(409);
		allowReturn.mockResolvedValue({ kind: "no_plan" });
		expect((await call()).status).toBe(404);
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await call()).status).toBe(401);
	});
});
