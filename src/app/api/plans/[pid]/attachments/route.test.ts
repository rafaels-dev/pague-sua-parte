import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => ({}) }));
const findPlanFor = vi.fn();
const addPhotos = vi.fn();
vi.mock("@/lib/plans/repo", () => ({ findPlanFor, addPhotos }));

const { POST } = await import("./route");
const ctx = { params: Promise.resolve({ pid: "p1" }) };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function post() {
	const form = new FormData();
	form.append("files", new File([PNG as BlobPart], "a.png"));
	const req = new Request("http://x", { method: "POST", body: form, headers: { "content-length": "500" } });
	const spy = vi.spyOn(req, "formData");
	return { res: POST(req, ctx), spy };
}

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
});

describe("POST /api/plans/:pid/attachments", () => {
	it("quem não criou o plano: 403 antes de ler o corpo", async () => {
		findPlanFor.mockResolvedValue({ createdBy: "outro", status: "open", attachments: [] });
		const { res, spy } = post();
		expect((await res).status).toBe(403);
		expect(spy).not.toHaveBeenCalled();
		expect(addPhotos).not.toHaveBeenCalled();
	});
	it("plano que não está aberto: 409 antes de ler o corpo", async () => {
		findPlanFor.mockResolvedValue({ createdBy: "u1", status: "cancelled", attachments: [] });
		const { res, spy } = post();
		expect((await res).status).toBe(409);
		expect(spy).not.toHaveBeenCalled();
	});
	it("quem não participa: 404", async () => {
		findPlanFor.mockResolvedValue(null);
		expect((await post().res).status).toBe(404);
	});
	it("criador com o plano aberto: grava", async () => {
		findPlanFor.mockResolvedValue({ createdBy: "u1", status: "open", attachments: [] });
		addPhotos.mockResolvedValue({ kind: "ok", view: { id: "p1" } });
		expect((await post().res).status).toBe(201);
		expect(addPhotos).toHaveBeenCalled();
	});
});
