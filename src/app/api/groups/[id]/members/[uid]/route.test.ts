import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const setMemberRole = vi.fn();
const removeMember = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ setMemberRole, removeMember }));

const { PATCH, DELETE } = await import("./route");
const GID = "507f1f77bcf86cd799439011";
const ctx = (id = GID, uid = "u2") => ({ params: Promise.resolve({ id, uid }) });
const patch = (body: unknown, ...a: [string?, string?]) =>
	PATCH(new Request("http://x", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), ctx(...a));
const del = (...a: [string?, string?]) => DELETE(new Request("http://x", { method: "DELETE" }), ctx(...a));

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("PATCH /api/groups/:id/members/:uid", () => {
	it("200 promove e repassa os argumentos", async () => {
		setMemberRole.mockResolvedValue({ status: "ok" });
		const res = await patch({ role: "admin" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ uid: "u2", role: "admin" });
		expect(setMemberRole).toHaveBeenCalledWith({ fake: true }, GID, "u1", "u2", "admin");
	});
	it("200 rebaixa", async () => {
		setMemberRole.mockResolvedValue({ status: "ok" });
		const res = await patch({ role: "member" });
		expect(await res.json()).toEqual({ uid: "u2", role: "member" });
	});
	it("422 para corpo inválido", async () => {
		for (const body of ["{", {}, { role: "dono" }, { role: 1 }]) expect((await patch(body)).status).toBe(422);
		expect(setMemberRole).not.toHaveBeenCalled();
	});
	it("403 para não admin", async () => {
		setMemberRole.mockResolvedValue({ status: "forbidden" });
		const res = await patch({ role: "admin" });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "Só quem administra o grupo pode fazer isso." });
	});
	it("404 para não membro / id malformado", async () => {
		setMemberRole.mockResolvedValue({ status: "not_found" });
		const res = await patch({ role: "admin" }, "ruim");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Grupo não encontrado." });
	});
	it("409 no próprio papel", async () => {
		setMemberRole.mockResolvedValue({ status: "self" });
		const res = await patch({ role: "member" }, GID, "u1");
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "Você não pode alterar o seu próprio papel." });
	});
	it("404 quando o alvo não é membro", async () => {
		setMemberRole.mockResolvedValue({ status: "target_missing" });
		const res = await patch({ role: "admin" });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Essa pessoa não faz mais parte do grupo." });
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await patch({ role: "admin" })).status).toBe(401);
	});
});

describe("DELETE /api/groups/:id/members/:uid", () => {
	it("200 remove", async () => {
		removeMember.mockResolvedValue({ status: "ok" });
		const res = await del();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(removeMember).toHaveBeenCalledWith({ fake: true }, GID, "u1", "u2", true); // ausente = true
	});
	it("allowReturn false/true repassado; não booleano ou JSON ruim = 422", async () => {
		removeMember.mockResolvedValue({ status: "ok" });
		const withBody = (b: string) => DELETE(new Request("http://x", { method: "DELETE", body: b }), ctx());
		await withBody(JSON.stringify({ allowReturn: false }));
		expect(removeMember).toHaveBeenLastCalledWith({ fake: true }, GID, "u1", "u2", false);
		await withBody(JSON.stringify({ allowReturn: true }));
		expect(removeMember).toHaveBeenLastCalledWith({ fake: true }, GID, "u1", "u2", true);
		removeMember.mockClear();
		for (const bad of [JSON.stringify({ allowReturn: "false" }), JSON.stringify({ allowReturn: null }), JSON.stringify({ allowReturn: 0 }), "{x"]) expect((await withBody(bad)).status).toBe(422);
		expect(removeMember).not.toHaveBeenCalled();
	});
	it("403 para não admin", async () => {
		removeMember.mockResolvedValue({ status: "forbidden" });
		const res = await del();
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "Só quem administra o grupo pode fazer isso." });
	});
	it("404 para não membro / id malformado", async () => {
		removeMember.mockResolvedValue({ status: "not_found" });
		const res = await del("ruim");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Grupo não encontrado." });
	});
	it("409 ao remover a si mesmo", async () => {
		removeMember.mockResolvedValue({ status: "self" });
		const res = await del(GID, "u1");
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "Você não pode remover a si mesmo do grupo." });
	});
	it("404 quando o alvo não é membro", async () => {
		removeMember.mockResolvedValue({ status: "target_missing" });
		const res = await del();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Essa pessoa não faz mais parte do grupo." });
	});
});

describe("pessoas sem login nas rotas de membro", () => {
	it("PATCH papel de pessoa sem login: 409", async () => {
		setMemberRole.mockResolvedValue({ status: "managed_target" });
		const res = await patch({ role: "admin" }, GID, "m_ben");
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "Pessoas sem celular não podem administrar o grupo." });
	});
	it("DELETE responsável por alguém: 409 com os nomes", async () => {
		removeMember.mockResolvedValue({ status: "responsible", name: "Renata", managed: ["Benjamim", "Vó", "Tio Zé"] });
		const res = await del(GID, "u2");
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "Renata cuida de Benjamim, Vó e Tio Zé. Troque o responsável antes de remover." });
		removeMember.mockResolvedValue({ status: "responsible", name: "Renata", managed: ["Benjamim"] });
		expect(await (await del(GID, "u2")).json()).toEqual({ error: "Renata cuida de Benjamim. Troque o responsável antes de remover." });
	});
	it("DELETE de pessoa sem login por admin: 200; por não admin: 403", async () => {
		removeMember.mockResolvedValue({ status: "ok" });
		expect((await del(GID, "m_ben")).status).toBe(200);
		removeMember.mockResolvedValue({ status: "forbidden" });
		expect((await del(GID, "m_ben")).status).toBe(403);
	});
});
