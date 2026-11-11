import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getObject = vi.fn();
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store, getAttachment: getObject }));
const getReceiptRef = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ getReceiptRef }));

const { GET } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e", uid: "u3" }) };
const call = () => GET(new Request("http://x"), ctx);

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /expenses/:eid/shares/:uid/receipt", () => {
	it("devolve os bytes com os cabeçalhos de segurança", async () => {
		getReceiptRef.mockResolvedValue({ status: "ok", key: "receipts/g/e/r", name: "pix açaí.png", contentType: "image/png" });
		getObject.mockResolvedValue({ body: new Blob(["png"]).stream(), size: 3 });
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("png");
		expect(getReceiptRef).toHaveBeenCalledWith({ fake: true }, "g", "e", "u3", "u1");
		expect(getObject).toHaveBeenCalledWith(store, "receipts/g/e/r");
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''pix%20a%C3%A7a%C3%AD.png");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
	});
	it("404 sem permissão ou sem comprovante, sem tocar no armazenamento", async () => {
		getReceiptRef.mockResolvedValue({ status: "not_found" });
		const res = await call();
		expect([res.status, await res.json()]).toEqual([404, { error: "Comprovante não encontrado." }]);
		expect(getObject).not.toHaveBeenCalled();
	});
	it("404 se o objeto sumiu do R2", async () => {
		getReceiptRef.mockResolvedValue({ status: "ok", key: "k", name: "a.png", contentType: "image/png" });
		getObject.mockResolvedValue(null);
		expect((await call()).status).toBe(404);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call()).status).toBe(401);
	});
});
