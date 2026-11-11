import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const previewInvite = vi.fn();
vi.mock("@/lib/groups/repo", () => ({ previewInvite }));

const { GET } = await import("./route");
const call = (token = "tok") => GET(new Request("http://x/api/invites/" + token), { params: Promise.resolve({ token }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /api/invites/:token", () => {
	it("200 com a prévia", async () => {
		const preview = { groupId: "g", groupName: "Viagem", memberCount: 3, alreadyMember: false };
		previewInvite.mockResolvedValue(preview);
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(preview);
		expect(previewInvite).toHaveBeenCalledWith({ fake: true }, "tok", "u1");
	});
	it("404 para convite inválido ou expirado", async () => {
		previewInvite.mockResolvedValue(null);
		const res = await call();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Este convite não é mais válido. Peça um novo link a quem te convidou." });
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call()).status).toBe(401);
	});
});
