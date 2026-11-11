import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const updateManagedMember = vi.fn();
const getGroupDetail = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ updateManagedMember, getGroupDetail }));

const { PATCH } = await import("./route");
const GID = "507f1f77bcf86cd799439011";
const DETAIL = { id: GID, name: "Família", role: "member", members: [] };
const patch = (body: unknown, uid = "m_ben") =>
	PATCH(new Request("http://x", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id: GID, uid }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u2", email: "a@b.com", name: "Renata" });
	updateManagedMember.mockResolvedValue({ status: "ok", uid: "m_ben" });
	getGroupDetail.mockResolvedValue(DETAIL);
});

describe("PATCH /api/groups/:id/managed-members/:uid", () => {
	it("200 com o detalhe; só repassa o que veio; null e vazio limpam a chave", async () => {
		const res = await patch({ name: " Ben " });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(DETAIL);
		expect(updateManagedMember).toHaveBeenCalledWith({ fake: true }, GID, "u2", "m_ben", { name: "Ben" });
		for (const pixKey of [null, ""]) {
			updateManagedMember.mockClear();
			await patch({ pixKey });
			expect(updateManagedMember.mock.calls[0][4]).toEqual({ pixKey: null });
		}
		updateManagedMember.mockClear();
		await patch({ pixKey: "ben@x.com", managedBy: "u3" });
		expect(updateManagedMember.mock.calls[0][4]).toEqual({ managedBy: "u3", pixKey: { type: "email", key: "ben@x.com" } });
	});
	it("422 por campo", async () => {
		for (const [body, field] of [[{ name: "" }, "name"], [{ managedBy: "" }, "managedBy"], [{ pixKey: "abc" }, "pixKey"]] as const) {
			const res = await patch(body);
			expect(res.status).toBe(422);
			expect(((await res.json()) as { field: string }).field).toBe(field);
		}
		expect(updateManagedMember).not.toHaveBeenCalled();
	});
	it("422 novo responsável inválido (do repo)", async () => {
		updateManagedMember.mockResolvedValue({ status: "invalid", field: "managedBy", error: "Escolha alguém do grupo para cuidar dessa pessoa." });
		expect((await patch({ managedBy: "m_outro" })).status).toBe(422);
	});
	it("403 quem não é admin nem responsável", async () => {
		updateManagedMember.mockResolvedValue({ status: "forbidden" });
		expect((await patch({ name: "X" })).status).toBe(403);
	});
	it("404 alvo não é pessoa sem login do grupo / grupo inexistente", async () => {
		updateManagedMember.mockResolvedValue({ status: "target_missing" });
		const res = await patch({ name: "X" }, "u3");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Essa pessoa não faz mais parte do grupo." });
		updateManagedMember.mockResolvedValue({ status: "not_found" });
		expect((await patch({ name: "X" })).status).toBe(404);
	});
	it("401 sem sessão", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await patch({ name: "X" })).status).toBe(401);
	});
});
