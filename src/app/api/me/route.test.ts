import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const upsertFromAuth = vi.fn();
const updateProfile = vi.fn();
vi.mock("@/lib/users/repo", () => ({ upsertFromAuth, updateProfile }));

const { GET, PUT } = await import("./route");

const user = { uid: "u1", email: "a@b.com", name: "Ana" };
const doc = (extra = {}) => ({ _id: "u1", email: "a@b.com", name: "Ana", createdAt: new Date(), updatedAt: new Date(), ...extra });
const put = (body: unknown) =>
	PUT(new Request("http://x/api/me", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue(user);
	upsertFromAuth.mockResolvedValue(doc());
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/me", () => {
	it("retorna o perfil do usuário do token", async () => {
		const res = await GET(new Request("http://x/api/me"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ uid: "u1", email: "a@b.com", name: "Ana", picture: null, displayName: null, pixKey: null });
		expect(upsertFromAuth).toHaveBeenCalledWith({ fake: true }, user);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		const res = await GET(new Request("http://x/api/me"));
		expect(res.status).toBe(401);
		expect(upsertFromAuth).not.toHaveBeenCalled();
	});
	it("500 genérico sem vazar detalhes", async () => {
		upsertFromAuth.mockRejectedValue(new Error("mongodb+srv://user:secret@host failed"));
		const res = await GET(new Request("http://x/api/me"));
		expect(res.status).toBe(500);
		const text = await res.text();
		expect(text).not.toContain("secret");
		expect(text).not.toContain("mongodb");
	});
});

describe("PUT /api/me", () => {
	it("normaliza a chave e usa o uid do token (ignora uid do corpo)", async () => {
		updateProfile.mockResolvedValue(doc({ displayName: "Aninha", pixKey: { type: "cpf", key: "52998224725" } }));
		const res = await put({ displayName: "  Aninha ", pixKey: "529.982.247-25", uid: "hacker" });
		expect(res.status).toBe(200);
		expect(updateProfile).toHaveBeenCalledWith({ fake: true }, "u1", {
			displayName: "Aninha",
			pixKey: { type: "cpf", key: "52998224725" },
		});
		expect(((await res.json()) as { pixKey: unknown }).pixKey).toEqual({ type: "cpf", key: "52998224725" });
	});
	it("422 para chave Pix inválida", async () => {
		const res = await put({ pixKey: "abc" });
		expect(res.status).toBe(422);
		const body = (await res.json()) as { field: string; error: string };
		expect(body.field).toBe("pixKey");
		expect(body.error).toMatch(/Chave Pix inválida/);
		expect(updateProfile).not.toHaveBeenCalled();
	});
	it("422 para nome vazio ou longo demais", async () => {
		expect((await put({ displayName: "   " })).status).toBe(422);
		expect((await put({ displayName: "a".repeat(61) })).status).toBe(422);
	});
	it("chave vazia remove a chave", async () => {
		updateProfile.mockResolvedValue(doc());
		await put({ pixKey: "" });
		expect(updateProfile).toHaveBeenCalledWith({ fake: true }, "u1", { pixKey: null });
	});
	it("400 para JSON inválido", async () => {
		expect((await put("{oops")).status).toBe(400);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await put({ displayName: "A" })).status).toBe(401);
		expect(updateProfile).not.toHaveBeenCalled();
	});
	it("500 genérico", async () => {
		updateProfile.mockRejectedValue(new Error("boom secret"));
		const res = await put({ displayName: "A" });
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain("secret");
	});
});
