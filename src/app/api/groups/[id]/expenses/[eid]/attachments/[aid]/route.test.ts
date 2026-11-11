import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getObject = vi.fn();
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store, getAttachment: getObject }));
const getAttachmentRef = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ getAttachmentRef }));

const { GET } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e", aid: "a" }) };
const call = () => GET(new Request("http://x"), ctx);

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET attachment", () => {
	it("devolve os bytes com os cabeçalhos de segurança", async () => {
		getAttachmentRef.mockResolvedValue({ status: "ok", key: "groups/g/e/a", name: "nota fiscal.pdf", contentType: "application/pdf" });
		getObject.mockResolvedValue({ body: new Blob(["%PDF-1"]).stream(), size: 6 });
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("%PDF-1");
		expect(getAttachmentRef).toHaveBeenCalledWith({ fake: true }, "g", "e", "a", "u1");
		expect(getObject).toHaveBeenCalledWith(store, "groups/g/e/a");
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-disposition")).toContain('inline; filename="nota fiscal.pdf"');
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
		expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
	});
	it("nome com acentos não quebra o cabeçalho", async () => {
		getAttachmentRef.mockResolvedValue({ status: "ok", key: "k", name: "açaí.png", contentType: "image/png" });
		getObject.mockResolvedValue({ body: new Blob(["x"]).stream(), size: 1 });
		const res = await call();
		expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''a%C3%A7a%C3%AD.png");
	});
	it("404 para não membro/ausente, sem tocar no storage", async () => {
		getAttachmentRef.mockResolvedValue({ status: "not_found" });
		expect((await call()).status).toBe(404);
		expect(getObject).not.toHaveBeenCalled();
	});
	it("404 se o objeto sumiu do R2", async () => {
		getAttachmentRef.mockResolvedValue({ status: "ok", key: "k", name: "a.pdf", contentType: "application/pdf" });
		getObject.mockResolvedValue(null);
		expect((await call()).status).toBe(404);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call()).status).toBe(401);
	});
});
