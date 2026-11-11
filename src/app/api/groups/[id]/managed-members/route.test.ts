import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const addManagedMember = vi.fn();
const getGroupDetail = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ addManagedMember, getGroupDetail }));

const { POST } = await import("./route");
const GID = "507f1f77bcf86cd799439011";
const DETAIL = { id: GID, name: "Família", role: "admin", members: [] };
const post = (body: unknown, id = GID) =>
	POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	addManagedMember.mockResolvedValue({ status: "ok", uid: "m_x" });
	getGroupDetail.mockResolvedValue(DETAIL);
});

describe("POST /api/groups/:id/managed-members", () => {
	it("201 com o detalhe do grupo; Pix normalizado; o chamador vem da sessão", async () => {
		const res = await post({ name: "  Benjamim ", managedBy: "u2", pixKey: "529.982.247-25", actor: "x" });
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual(DETAIL);
		expect(addManagedMember).toHaveBeenCalledWith({ fake: true }, GID, "u1", { name: "Benjamim", managedBy: "u2", pixKey: { type: "cpf", key: "52998224725" } });
	});
	it("sem chave (ausente, vazia ou null) é permitido", async () => {
		for (const pixKey of [undefined, "", null]) {
			addManagedMember.mockClear();
			expect((await post({ name: "Vó", managedBy: "u2", pixKey })).status).toBe(201);
			expect(addManagedMember.mock.calls[0][3]).toEqual({ name: "Vó", managedBy: "u2" });
		}
	});
	it("422 com o campo: name, managedBy, pixKey (admin)", async () => {
		getGroupDetail.mockResolvedValue({ ...DETAIL, role: "admin" });
		for (const [body, field] of [
			[{ managedBy: "u2" }, "name"],
			[{ name: "   ", managedBy: "u2" }, "name"],
			[{ name: "x".repeat(61), managedBy: "u2" }, "name"],
			[{ name: "Vó" }, "managedBy"],
			[{ name: "Vó", managedBy: "u2", pixKey: "123" }, "pixKey"],
		] as const) {
			const res = await post(body);
			expect(res.status).toBe(422);
			expect(((await res.json()) as { field: string }).field).toBe(field);
		}
		expect(addManagedMember).not.toHaveBeenCalled();
	});
	it("422 managedBy que não é membro real (do repo)", async () => {
		addManagedMember.mockResolvedValue({ status: "invalid", field: "managedBy", error: "Escolha alguém do grupo para cuidar dessa pessoa." });
		const res = await post({ name: "Vó", managedBy: "fora" });
		expect(res.status).toBe(422);
		expect(((await res.json()) as { field: string }).field).toBe("managedBy");
	});
	it("403 só admin, também diante de dados inválidos (não vaza validação)", async () => {
		addManagedMember.mockResolvedValue({ status: "forbidden" });
		const res = await post({ name: "Vó", managedBy: "u2" });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "Só quem administra o grupo pode fazer isso." });
		getGroupDetail.mockResolvedValue({ ...DETAIL, role: "member" });
		expect((await post({ name: "" })).status).toBe(403);
	});
	it("404 não membro / malformado", async () => {
		addManagedMember.mockResolvedValue({ status: "not_found" });
		expect((await post({ name: "Vó", managedBy: "u2" })).status).toBe(404);
		getGroupDetail.mockResolvedValue(null);
		expect((await post({ name: "" })).status).toBe(404);
	});
	it("409 grupo cheio", async () => {
		addManagedMember.mockResolvedValue({ status: "full" });
		const res = await post({ name: "Vó", managedBy: "u2" });
		expect(res.status).toBe(409);
	});
	it("422 corpo ilegível; 401 sem sessão", async () => {
		expect((await post("{")).status).toBe(422);
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await post({ name: "Vó", managedBy: "u2" })).status).toBe(401);
	});
});
