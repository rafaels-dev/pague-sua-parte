import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getGroupSummary = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ getGroupSummary }));

const { GET } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g" }) };
beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /groups/:id/summary", () => {
	it("200 com o resumo, pedindo pelo membro autenticado", async () => {
		getGroupSummary.mockResolvedValue({ groupName: "Casa", debts: [] });
		const res = await GET(new Request("http://x"), ctx);
		expect([res.status, await res.json()]).toEqual([200, { groupName: "Casa", debts: [] }]);
		expect(getGroupSummary).toHaveBeenCalledWith({ fake: true }, "g", "u1");
	});
	it("404 para não membro / grupo inexistente, 401 sem login", async () => {
		getGroupSummary.mockResolvedValue(null);
		const res = await GET(new Request("http://x"), ctx);
		expect([res.status, await res.json()]).toEqual([404, { error: "Grupo não encontrado." }]);
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
	});
});
