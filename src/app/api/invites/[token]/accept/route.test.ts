import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const acceptInvite = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ acceptInvite }));
const upsertFromAuth = vi.fn();
vi.mock("@/lib/users/repo", () => ({ upsertFromAuth }));

const { POST } = await import("./route");
const user = { uid: "u1", email: "a@b.com", name: "Ana" };
const call = () => POST(new Request("http://x/api/invites/tok/accept", { method: "POST" }), { params: Promise.resolve({ token: "tok" }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue(user);
	upsertFromAuth.mockResolvedValue({});
});

describe("POST /api/invites/:token/accept", () => {
	it("200 com groupId e garante o documento do usuário antes de entrar", async () => {
		acceptInvite.mockResolvedValue({ status: "ok", groupId: "g1" });
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ groupId: "g1" });
		expect(upsertFromAuth).toHaveBeenCalledWith({ fake: true }, user);
		expect(upsertFromAuth.mock.invocationCallOrder[0]).toBeLessThan(acceptInvite.mock.invocationCallOrder[0]);
	});
	it("idempotente: chamar duas vezes devolve 200 nas duas", async () => {
		acceptInvite.mockResolvedValue({ status: "ok", groupId: "g1" });
		expect((await call()).status).toBe(200);
		expect((await call()).status).toBe(200);
	});
	it("404 para convite inválido ou expirado", async () => {
		acceptInvite.mockResolvedValue({ status: "invalid" });
		const res = await call();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Este convite não é mais válido. Peça um novo link a quem te convidou." });
	});
	it("409 quando o grupo está cheio", async () => {
		acceptInvite.mockResolvedValue({ status: "full" });
		const res = await call();
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "Este grupo já está cheio." });
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call()).status).toBe(401);
		expect(acceptInvite).not.toHaveBeenCalled();
	});
});
