import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store }));
const markSelfPaid = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ markSelfPaid }));

const { POST } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e", uid: "u3" }) };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2];
const upload = (bytes: number[] | null, name = "pix.png") => {
	const form = new FormData();
	if (bytes) form.append("file", new File([new Uint8Array(bytes)], name));
	return POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }), ctx);
};
const out = async (res: Response) => [res.status, await res.json()];

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	markSelfPaid.mockResolvedValue({ status: "ok", expense: { id: "e" } });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /expenses/:eid/shares/:uid/payment", () => {
	it("200 com comprovante: arquivo farejado vai para o repo", async () => {
		expect(await out(await upload(PNG))).toEqual([200, { id: "e" }]);
		const args = markSelfPaid.mock.calls[0];
		expect(args[0]).toEqual({ fake: true });
		expect(args[1]).toBe(store);
		expect(args[2]).toMatchObject({ groupId: "g", eid: "e", uid: "u1", targetUid: "u3", file: { name: "pix.png", contentType: "image/png" } });
	});
	it("200 sem arquivo (multipart vazio, corpo ausente e campo sem arquivo)", async () => {
		expect((await upload(null)).status).toBe(200);
		expect((await POST(new Request("http://x", { method: "POST" }), ctx)).status).toBe(200);
		const form = new FormData();
		form.append("file", new File([], ""));
		expect((await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }), ctx)).status).toBe(200);
		for (const c of markSelfPaid.mock.calls) expect(c[2].file).toBeUndefined();
	});
	it("422 em file para tipo não aceito, grande demais e mais de um arquivo, sem chamar o repo", async () => {
		expect(await out(await upload([1, 2, 3, 4], "x.exe"))).toEqual([422, { error: "Só aceitamos foto (JPG, PNG, WebP) ou PDF.", field: "file" }]);
		const big = await upload([...PNG, ...new Array(5 * 1024 * 1024).fill(0)]);
		expect(await out(big)).toEqual([422, { error: "O comprovante pode ter no máximo 5 MB.", field: "file" }]);
		const form = new FormData();
		form.append("file", new File([new Uint8Array(PNG)], "a.png"));
		form.append("file", new File([new Uint8Array(PNG)], "b.png"));
		const two = await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }), ctx);
		expect([two.status, ((await two.json()) as { field: string }).field]).toEqual([422, "file"]);
		expect(markSelfPaid).not.toHaveBeenCalled();
	});
	it("mapeia 404, 403, 404 e 409 com as mensagens do contrato", async () => {
		const cases: [string, number, string][] = [
			["no_group", 404, "Grupo não encontrado."],
			["no_expense", 404, "Despesa não encontrada."],
			["forbidden", 403, "Só quem deve pode avisar que pagou."],
			["no_share", 404, "Essa pessoa não participa desta despesa."],
			["conflict", 409, "Essa despesa acabou de ser alterada. Tente de novo."],
		];
		for (const [status, code, error] of cases) {
			markSelfPaid.mockResolvedValue({ status });
			expect(await out(await upload(null))).toEqual([code, { error }]);
		}
	});
	it("401 sem autenticação e 500 genérico em erro", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await upload(null)).status).toBe(401);
		requireUser.mockResolvedValue({ uid: "u1" });
		markSelfPaid.mockRejectedValue(new Error("boom"));
		expect((await upload(null)).status).toBe(500);
	});
});

describe("tamanho do corpo", () => {
	it("recusa multipart sem Content-Length (envio em pedaços) antes de ler o corpo", async () => {
		const form = new FormData();
		form.append("file", new File([new Uint8Array(PNG)], "a.png"));
		const res = await POST(new Request("http://x", { method: "POST", body: form }), ctx);
		expect(res.status).toBe(422);
		expect(markSelfPaid).not.toHaveBeenCalled();
	});
});
