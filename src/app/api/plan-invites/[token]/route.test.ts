import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const previewPlanInvite = vi.fn();
const acceptPlanInvite = vi.fn();
vi.mock("@/lib/plans/repo", () => ({ previewPlanInvite, acceptPlanInvite }));
const afterMemberJoined = vi.fn();
vi.mock("@/lib/notifications/events", () => ({ afterMemberJoined }));
vi.mock("@/lib/notifications/welcome", () => ({ upsertAndWelcome: vi.fn() }));

const { GET } = await import("./route");
const { POST } = await import("./accept/route");
const get = () => GET(new Request("http://x/api/plan-invites/tok"), { params: Promise.resolve({ token: "tok" }) });
const post = () => POST(new Request("http://x/api/plan-invites/tok/accept", { method: "POST", body: "{}" }), { params: Promise.resolve({ token: "tok" }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /api/plan-invites/:token", () => {
	it("200 com a prévia do plano que virou grupo", async () => {
		const p = { closed: true, planName: "Hotel", groupName: "Viagem", creatorName: "R", alreadyMember: false };
		previewPlanInvite.mockResolvedValue(p);
		const res = await get();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(p);
	});
	it("404 genérico quando inválido", async () => {
		previewPlanInvite.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(404);
		expect((await res.json()).error).toMatch(/não é mais válido/);
	});
	it("404 com a mensagem do prazo, sem nomes", async () => {
		previewPlanInvite.mockResolvedValue({ gone: true });
		const res = await get();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Este plano já virou o grupo e o link não vale mais. Peça o link do grupo a quem te convidou." });
	});
	it("401 sem login", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await get()).status).toBe(401);
	});
});

describe("POST /api/plan-invites/:token/accept", () => {
	it("plano aberto: devolve planId, sem aviso de entrada no grupo", async () => {
		acceptPlanInvite.mockResolvedValue({ status: "ok", planId: "p1", joined: true });
		const res = await post();
		expect(await res.json()).toEqual({ planId: "p1" });
		expect(afterMemberJoined).not.toHaveBeenCalled();
	});
	it("plano virou grupo: devolve groupId e avisa o administrador só quando entrou agora", async () => {
		acceptPlanInvite.mockResolvedValue({ status: "group", groupId: "g1", joined: true });
		expect(await (await post()).json()).toEqual({ groupId: "g1" });
		expect(afterMemberJoined).toHaveBeenCalledWith("g1", "u1");
		afterMemberJoined.mockClear();
		acceptPlanInvite.mockResolvedValue({ status: "group", groupId: "g1" });
		expect(await (await post()).json()).toEqual({ groupId: "g1" });
		expect(afterMemberJoined).not.toHaveBeenCalled();
	});
	it("removido do grupo: 403 com texto próprio", async () => {
		acceptPlanInvite.mockResolvedValue({ status: "group_removed" });
		const res = await post();
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "Você não pode entrar neste grupo. Fale com quem organiza." });
		expect(afterMemberJoined).not.toHaveBeenCalled();
	});
	it("erros: removed 403, gone 404, group_full 409, invalid 404", async () => {
		for (const [status, code] of [["removed", 403], ["gone", 404], ["group_full", 409], ["invalid", 404]] as const) {
			acceptPlanInvite.mockResolvedValue({ status });
			expect((await post()).status).toBe(code);
		}
		expect(afterMemberJoined).not.toHaveBeenCalled();
	});
});
