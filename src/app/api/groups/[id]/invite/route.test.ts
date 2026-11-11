import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getOrCreateInvite = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ getOrCreateInvite }));

const { POST } = await import("./route");
const call = (body?: string, id = "507f1f77bcf86cd799439011") =>
	POST(new Request("http://x/api/groups/x/invite", { method: "POST", body }), { params: Promise.resolve({ id }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("POST /api/groups/:id/invite", () => {
	it("200 com token e expiresAt ISO (corpo vazio = sem regenerar)", async () => {
		const expiresAt = new Date("2026-01-08T00:00:00Z");
		getOrCreateInvite.mockResolvedValue({ status: "ok", token: "tok", expiresAt });
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ token: "tok", expiresAt: "2026-01-08T00:00:00.000Z" });
		expect(getOrCreateInvite).toHaveBeenCalledWith({ fake: true }, "507f1f77bcf86cd799439011", "u1", false);
	});
	it("repassa regenerate: true", async () => {
		getOrCreateInvite.mockResolvedValue({ status: "ok", token: "t", expiresAt: new Date() });
		await call(JSON.stringify({ regenerate: true }));
		expect(getOrCreateInvite.mock.calls[0][3]).toBe(true);
	});
	it("403 quando não admin tenta regenerar", async () => {
		getOrCreateInvite.mockResolvedValue({ status: "forbidden" });
		const res = await call(JSON.stringify({ regenerate: true }));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "Só quem administra o grupo pode gerar um novo link." });
	});
	it("404 para não membro / id malformado", async () => {
		getOrCreateInvite.mockResolvedValue({ status: "not_found" });
		const res = await call(undefined, "ruim");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Grupo não encontrado." });
	});
	it("400 para JSON ou tipo inválido", async () => {
		expect((await call("{")).status).toBe(400);
		expect((await call(JSON.stringify({ regenerate: "sim" }))).status).toBe(400);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call()).status).toBe(401);
	});
});
