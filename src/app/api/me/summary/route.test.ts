import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getSummary = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ getSummary }));

const { GET } = await import("./route");
beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /api/me/summary", () => {
	it("200 com os totais", async () => {
		getSummary.mockResolvedValue({ toReceiveCents: 5, toPayCents: 7 });
		const res = await GET(new Request("http://x"));
		expect(await res.json()).toEqual({ toReceiveCents: 5, toPayCents: 7 });
		expect(getSummary).toHaveBeenCalledWith({ fake: true }, "u1");
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await GET(new Request("http://x"))).status).toBe(401);
	});
});
