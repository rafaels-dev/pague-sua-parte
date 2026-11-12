import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store }));
const refundShare = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ refundShare }));

const { POST } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e", uid: "u3" }) };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2];
const upload = (bytes: number[] | null) => {
	const form = new FormData();
	if (bytes) form.append("file", new File([new Uint8Array(bytes)], "dev.png"));
	return POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }), ctx);
};
const out = async (res: Response) => [res.status, await res.json()];

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	refundShare.mockResolvedValue({ status: "ok", expense: { id: "e" } });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /expenses/:eid/shares/:uid/refund (Devolvi)", () => {
	it("200 com e sem comprovante; o repo recebe quem pede e o arquivo farejado", async () => {
		expect(await out(await upload(PNG))).toEqual([200, { id: "e" }]);
		expect(refundShare.mock.calls[0][2]).toMatchObject({ groupId: "g", eid: "e", uid: "u1", targetUid: "u3", file: { name: "dev.png", contentType: "image/png" } });
		expect((await POST(new Request("http://x", { method: "POST" }), ctx)).status).toBe(200);
		expect(refundShare.mock.calls[1][2].file).toBeUndefined();
	});
	it("arquivo que não é foto/PDF: 422 sem chamar o repo", async () => {
		expect((await upload([1, 2, 3, 4])).status).toBe(422);
		expect(refundShare).not.toHaveBeenCalled();
	});
	it("mensagens do contrato", async () => {
		refundShare.mockResolvedValue({ status: "forbidden" });
		expect(await out(await upload(null))).toEqual([403, { error: "Só quem pagou a despesa ou quem administra o grupo pode marcar a devolução." }]);
		refundShare.mockResolvedValue({ status: "no_share" });
		expect((await upload(null)).status).toBe(404);
		refundShare.mockResolvedValue({ status: "conflict" });
		expect(await out(await upload(null))).toEqual([409, { error: "Essa despesa acabou de ser alterada. Tente de novo." }]);
		refundShare.mockResolvedValue({ status: "no_group" });
		expect((await upload(null)).status).toBe(404);
	});
	it("401 sem login", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await upload(null)).status).toBe(401);
	});
});
