import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getReceivables = vi.fn();
vi.mock("@/lib/payments/repo", () => ({ getReceivables }));

const { GET } = await import("./route");
beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/me/receivables", () => {
	it("200 com os devedores; o uid vem só da sessão", async () => {
		getReceivables.mockResolvedValue({ debtors: [], totalCents: 0, nowCents: 0, managedCents: 0, truncated: false });
		const res = await GET(new Request("http://x/api/me/receivables?uid=outro"));
		expect([res.status, await res.json()]).toEqual([200, { debtors: [], totalCents: 0, nowCents: 0, managedCents: 0, truncated: false }]);
		expect(getReceivables).toHaveBeenCalledWith({ fake: true }, "u1");
	});
	it("401 sem autenticação e 500 genérico", async () => {
		requireUser.mockRejectedValueOnce(new UnauthorizedError("x"));
		expect((await GET(new Request("http://x"))).status).toBe(401);
		getReceivables.mockRejectedValue(new Error("boom"));
		expect((await GET(new Request("http://x"))).status).toBe(500);
	});
});
