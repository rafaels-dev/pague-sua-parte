import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getPayables = vi.fn();
vi.mock("@/lib/payments/repo", () => ({ getPayables }));

const { GET } = await import("./route");
beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/me/payables", () => {
	it("200 com os destinatários; o uid vem só da sessão", async () => {
		getPayables.mockResolvedValue({ recipients: [], truncated: false });
		const res = await GET(new Request("http://x/api/me/payables?uid=outro"));
		expect([res.status, await res.json()]).toEqual([200, { recipients: [], truncated: false }]);
		expect(getPayables).toHaveBeenCalledWith({ fake: true }, "u1");
	});
	it("401 sem autenticação e 500 genérico", async () => {
		requireUser.mockRejectedValueOnce(new UnauthorizedError("x"));
		expect((await GET(new Request("http://x"))).status).toBe(401);
		getPayables.mockRejectedValue(new Error("boom"));
		expect((await GET(new Request("http://x"))).status).toBe(500);
	});
	it("com ?groupId repassa o grupo e responde 404 se não for membro", async () => {
		getPayables.mockResolvedValueOnce({ recipients: [], truncated: false });
		const ok = await GET(new Request("http://x/api/me/payables?groupId=0123456789abcdef01234567"));
		expect(ok.status).toBe(200);
		expect(getPayables).toHaveBeenCalledWith({ fake: true }, "u1", undefined, "0123456789abcdef01234567");
		getPayables.mockResolvedValueOnce(null);
		const res = await GET(new Request("http://x/api/me/payables?groupId=outro"));
		expect([res.status, await res.json()]).toEqual([404, { error: "Grupo não encontrado." }]);
	});
});
