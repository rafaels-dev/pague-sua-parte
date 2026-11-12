import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getAttachment = vi.fn();
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => ({}), getAttachment }));
const getPhotoRef = vi.fn();
const removePhoto = vi.fn();
vi.mock("@/lib/plans/repo", () => ({ getPhotoRef, removePhoto }));

const { GET, DELETE } = await import("./route");
const ctx = { params: Promise.resolve({ pid: "p1", aid: "a1" }) };

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
});

describe("GET /api/plans/:pid/attachments/:aid", () => {
	it("participante: a foto com Cache-Control privado e sem expor a chave do armazenamento", async () => {
		getPhotoRef.mockResolvedValue({ key: "plans/p1/a1", name: "quarto.jpg", contentType: "image/jpeg" });
		getAttachment.mockResolvedValue({ body: new Blob(["x"]).stream(), size: 1 });
		const res = await GET(new Request("http://x"), ctx);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect([...res.headers.values()].join(" ")).not.toContain("plans/p1/a1");
		expect(getPhotoRef).toHaveBeenCalledWith({ fake: true }, "p1", "u1", "a1");
	});
	it("quem não participa recebe 404 e o armazenamento nem é consultado", async () => {
		getPhotoRef.mockResolvedValue(null);
		expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
		expect(getAttachment).not.toHaveBeenCalled();
	});
	it("sem login: 401", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
	});
});

describe("DELETE /api/plans/:pid/attachments/:aid", () => {
	it("quem não criou o plano: 403", async () => {
		removePhoto.mockResolvedValue({ kind: "forbidden" });
		expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(403);
	});
	it("criador: devolve a visão do plano", async () => {
		removePhoto.mockResolvedValue({ kind: "ok", view: { id: "p1" } });
		const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
		expect(await res.json()).toEqual({ id: "p1" });
	});
});
