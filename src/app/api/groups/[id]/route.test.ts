import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getGroupDetail = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ getGroupDetail }));

const { GET } = await import("./route");
const call = (id: string) => GET(new Request("http://x/api/groups/" + id), { params: Promise.resolve({ id }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /api/groups/:id", () => {
	it("200 com o detalhe, sem e-mail nem chave Pix", async () => {
		const detail = {
			id: "507f1f77bcf86cd799439011",
			name: "G",
			role: "admin",
			members: [{ uid: "u1", name: "Ana", picture: null, role: "admin", hasPixKey: true, isYou: true }],
		};
		getGroupDetail.mockResolvedValue(detail);
		const res = await call(detail.id);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual(detail);
		expect(JSON.stringify(body)).not.toMatch(/email|pixKey/);
		expect(getGroupDetail).toHaveBeenCalledWith({ fake: true }, detail.id, "u1");
	});
	it("404 igual para não membro, inexistente ou id malformado", async () => {
		getGroupDetail.mockResolvedValue(null);
		for (const id of ["507f1f77bcf86cd799439011", "malformado"]) {
			const res = await call(id);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "Grupo não encontrado.", code: "no_group" });
		}
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call("x")).status).toBe(401);
		expect(getGroupDetail).not.toHaveBeenCalled();
	});
});
