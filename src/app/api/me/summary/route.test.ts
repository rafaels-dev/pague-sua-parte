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

describe("GET /api/me/summary: pessoas sem login", () => {
	it("repassa managed do repo; o uid vem só da sessão", async () => {
		const managed = [{ uid: "m_ben", name: "Benjamim", groupId: "g", groupName: "Família", toReceiveCents: 1, toPayCents: 2 }];
		getSummary.mockResolvedValue({ toReceiveCents: 5, toPayCents: 7, managed });
		const res = await GET(new Request("http://x/api/me/summary?uid=m_ben", { headers: { "x-uid": "m_ben" } }));
		expect(await res.json()).toEqual({ toReceiveCents: 5, toPayCents: 7, managed });
		expect(getSummary).toHaveBeenCalledWith({ fake: true }, "u1");
	});
});

describe("GET /api/me/summary?groupId=", () => {
	it("repassa o grupo ao repo; o uid vem só da sessão", async () => {
		getSummary.mockResolvedValue({ toReceiveCents: 1, toPayCents: 2, managed: [] });
		const res = await GET(new Request("http://x/api/me/summary?groupId=0123456789abcdef01234567"));
		expect([res.status, await res.json()]).toEqual([200, { toReceiveCents: 1, toPayCents: 2, managed: [] }]);
		expect(getSummary).toHaveBeenCalledWith({ fake: true }, "u1", undefined, "0123456789abcdef01234567");
	});
	it("404 quando não é membro (ou o id é inválido)", async () => {
		getSummary.mockResolvedValue(null);
		const res = await GET(new Request("http://x/api/me/summary?groupId=lixo"));
		expect([res.status, await res.json()]).toEqual([404, { error: "Grupo não encontrado." }]);
	});
});
