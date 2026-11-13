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
const call = (pid: string) => GET(new Request("http://x"), { params: Promise.resolve({ id: "g", eid: "e", uid: "u3", pid }) });

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /expenses/:eid/shares/:uid/part-receipt/:pid", () => {
	it("devolve os bytes do parcial com os cabeçalhos privados; o repo recebe o pid", async () => {
		getReceiptRef.mockResolvedValue({ status: "ok", key: "receipts/g/e/r", name: "p.png", contentType: "image/png" });
		getObject.mockResolvedValue({ body: new Blob(["png"]).stream(), size: 3 });
		const res = await call("a1b2c3");
		expect(res.status).toBe(200);
		expect(getReceiptRef).toHaveBeenCalledWith({ fake: true }, "g", "e", "u3", "u1", "payment", "a1b2c3");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
		expect(await res.text()).toBe("png");
	});
	it("pid malformado, de outra parte e de outra despesa: o MESMO 404, sem consultar o armazenamento e sem vazar nada", async () => {
		const bodies: unknown[] = [];
		// malformado: nem chega ao repositório
		for (const bad of ["../x", "A B", "x".repeat(41), "%2e%2e", "a/b", "ÇÇ"]) {
			const res = await call(bad);
			bodies.push([res.status, await res.json()]);
		}
		expect(getReceiptRef).not.toHaveBeenCalled();
		// bem formado mas que não é parcial desta parte (de outra parte ou de outra despesa): o repo diz not_found
		getReceiptRef.mockResolvedValue({ status: "not_found" });
		for (const other of ["0123456789abcdef0123456789abcdef", "old-0"]) {
			const res = await call(other);
			bodies.push([res.status, await res.json()]);
		}
		expect(getReceiptRef).toHaveBeenCalledTimes(2);
		expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
		expect(bodies[0]).toEqual([404, { error: "Comprovante não encontrado." }]);
		expect(getObject).not.toHaveBeenCalled();
	});
	it("404 quando o arquivo não existe no armazenamento, e 401 sem login", async () => {
		getReceiptRef.mockResolvedValue({ status: "ok", key: "k", name: "p.png", contentType: "image/png" });
		getObject.mockResolvedValue(null);
		expect((await call("a1")).status).toBe(404);
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await call("a1")).status).toBe(401);
	});
});
