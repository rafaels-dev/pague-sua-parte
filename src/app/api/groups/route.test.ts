import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const listGroups = vi.fn();
const createGroup = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ listGroups, createGroup }));

const { GET, POST } = await import("./route");

const post = (body: unknown) =>
	POST(new Request("http://x/api/groups", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/groups", () => {
	it("lista os grupos do usuário", async () => {
		const groups = [{ id: "a", name: "G", memberCount: 2, role: "member" }];
		listGroups.mockResolvedValue(groups);
		const res = await GET(new Request("http://x/api/groups"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ groups });
		expect(listGroups).toHaveBeenCalledWith({ fake: true }, "u1");
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await GET(new Request("http://x/api/groups"))).status).toBe(401);
	});
	it("500 genérico sem vazar detalhes", async () => {
		listGroups.mockRejectedValue(new Error("mongodb://segredo"));
		const res = await GET(new Request("http://x/api/groups"));
		expect(res.status).toBe(500);
		expect(JSON.stringify(await res.json())).not.toContain("segredo");
	});
});

describe("POST /api/groups", () => {
	it("cria com o nome aparado e responde 201", async () => {
		createGroup.mockResolvedValue({ id: "a", name: "Viagem", memberCount: 1, role: "admin" });
		const res = await post({ name: "  Viagem  " });
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ id: "a", name: "Viagem", memberCount: 1, role: "admin" });
		expect(createGroup).toHaveBeenCalledWith({ fake: true }, "u1", "Viagem");
	});
	it.each([[{ name: "   " }], [{ name: "a".repeat(61) }], [{}], [{ name: 5 }]])("422 com field=name para %j", async (body) => {
		const res = await post(body);
		expect(res.status).toBe(422);
		expect(((await res.json()) as { field: string }).field).toBe("name");
		expect(createGroup).not.toHaveBeenCalled();
	});
	it("aceita 60 caracteres", async () => {
		createGroup.mockResolvedValue({});
		expect((await post({ name: "a".repeat(60) })).status).toBe(201);
	});
	it("400 para JSON inválido", async () => {
		expect((await post("{")).status).toBe(400);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await post({ name: "x" })).status).toBe(401);
	});
});
