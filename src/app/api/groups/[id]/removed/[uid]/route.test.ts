import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const allowReturnToGroup = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ allowReturnToGroup }));

const { DELETE } = await import("./route");
const call = () => DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: "g", uid: "x" }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("DELETE /api/groups/:id/removed/:uid", () => {
	it("200 para o administrador (idempotente)", async () => {
		allowReturnToGroup.mockResolvedValue({ status: "ok" });
		expect((await call()).status).toBe(200);
		expect((await call()).status).toBe(200);
		expect(allowReturnToGroup).toHaveBeenCalledWith({ fake: true }, "g", "u1", "x");
	});
	it("403 para membro comum e 404 para quem não é do grupo", async () => {
		allowReturnToGroup.mockResolvedValue({ status: "forbidden" });
		expect((await call()).status).toBe(403);
		allowReturnToGroup.mockResolvedValue({ status: "not_found" });
		expect((await call()).status).toBe(404);
	});
	it("401 sem login", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call()).status).toBe(401);
	});
});
