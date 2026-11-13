import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store }));
const payBatch = vi.fn();
vi.mock("@/lib/payments/repo", () => ({ payBatch }));

const { POST } = await import("./route");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2];
const ITEM = { groupId: "507f1f77bcf86cd799439011", expenseId: "607f1f77bcf86cd799439001", shareUid: "u1" };
const multipart = (data: unknown, bytes?: number[] | null, name = "pix.png") => {
	const form = new FormData();
	if (data !== undefined) form.append("data", typeof data === "string" ? data : JSON.stringify(data));
	if (bytes) form.append("file", new File([new Uint8Array(bytes)], name));
	return POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }));
};
const json = (body: unknown) =>
	POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } }));
const out = async (res: Response) => [res.status, await res.json()];
const OK = { status: "ok", batchId: "b", paid: [{ ...ITEM, amountCents: 100 }], failed: [], totalPaidCents: 100, hasReceipt: true };

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
	payBatch.mockResolvedValue(OK);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/me/payments", () => {
	it("200 multipart com comprovante: repassa itens e arquivo farejado; resposta sem o status interno", async () => {
		expect(await out(await multipart({ items: [ITEM] }, PNG))).toEqual([200, { batchId: "b", paid: OK.paid, failed: [], totalPaidCents: 100, hasReceipt: true }]);
		const args = payBatch.mock.calls[0];
		expect(args[0]).toEqual({ fake: true });
		expect(args[1]).toBe(store);
		expect(args[2]).toMatchObject({ uid: "u1", items: [ITEM], file: { name: "pix.png", contentType: "image/png" } });
	});
	it("expectedTotalCents (o total que a tela mostrou) é repassado; ausente = cliente antigo; inválido = 422 sem chamar o repo", async () => {
		expect((await multipart({ items: [ITEM], expectedTotalCents: 1000 })).status).toBe(200);
		expect(payBatch.mock.calls.at(-1)?.[2]).toMatchObject({ expectedTotalCents: 1000 });
		expect((await json({ items: [ITEM] })).status).toBe(200);
		expect(payBatch.mock.calls.at(-1)?.[2].expectedTotalCents).toBeUndefined();
		payBatch.mockClear();
		for (const bad of [-1, 1.5, "10", null, 1e12]) expect((await json({ items: [ITEM], expectedTotalCents: bad })).status).toBe(422);
		expect(payBatch).not.toHaveBeenCalled();
	});
	it("total que mudou: 409 com a mensagem simples", async () => {
		payBatch.mockResolvedValue({ status: "stale" });
		expect(await out(await json({ items: [ITEM], expectedTotalCents: 1000 }))).toEqual([409, { error: "Os valores mudaram. Atualize e confira antes de pagar." }]);
	});
	it("200 sem comprovante: multipart sem arquivo e JSON puro", async () => {
		expect((await multipart({ items: [ITEM] })).status).toBe(200);
		expect((await json({ items: [ITEM] })).status).toBe(200);
		for (const c of payBatch.mock.calls) expect(c[2].file).toBeUndefined();
	});
	it("422 items: ausente, JSON ruim, vazio, mais de 50, ids malformados", async () => {
		const bad = { error: "Escolha de 1 a 50 contas, sem repetir.", field: "items" };
		expect(await out(await multipart(undefined))).toEqual([422, bad]);
		expect(await out(await multipart("{nao"))).toEqual([422, bad]);
		expect(await out(await json({ items: [] }))).toEqual([422, bad]);
		expect(await out(await json("lixo"))).toEqual([422, bad]);
		expect(await out(await json({ items: Array.from({ length: 51 }, (_, i) => ({ ...ITEM, shareUid: `u${i}` })) }))).toEqual([422, bad]);
		expect((await json({ items: [{ ...ITEM, groupId: "x" }] })).status).toBe(422);
		expect((await json({ items: [{ ...ITEM, shareUid: "" }] })).status).toBe(422);
		expect(payBatch).not.toHaveBeenCalled();
	});
	it("422 file: tipo, tamanho e mais de um arquivo, sem chamar o repo", async () => {
		expect(await out(await multipart({ items: [ITEM] }, [1, 2, 3, 4], "x.exe"))).toEqual([422, { error: "Só aceitamos foto (JPG, PNG, WebP) ou PDF.", field: "file" }]);
		const big = await multipart({ items: [ITEM] }, [...PNG, ...new Array(4 * 1024 * 1024).fill(0)]);
		expect(await out(big)).toEqual([422, { error: "O comprovante pode ter no máximo 4 MB.", field: "file" }]);
		const form = new FormData();
		form.append("data", JSON.stringify({ items: [ITEM] }));
		form.append("file", new File([new Uint8Array(PNG)], "a.png"));
		form.append("file", new File([new Uint8Array(PNG)], "b.png"));
		const two = await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }));
		expect([two.status, ((await two.json()) as { field: string }).field]).toEqual([422, "file"]);
		expect(payBatch).not.toHaveBeenCalled();
	});
	it("recusa multipart sem Content-Length", async () => {
		const form = new FormData();
		form.append("data", JSON.stringify({ items: [ITEM] }));
		expect((await POST(new Request("http://x", { method: "POST", body: form }))).status).toBe(422);
		expect(payBatch).not.toHaveBeenCalled();
	});
	it("mapeia os resultados do repo", async () => {
		const cases: [unknown, number, unknown][] = [
			[{ status: "no_group" }, 404, { error: "Grupo não encontrado." }],
			[{ status: "no_expense" }, 404, { error: "Despesa não encontrada." }],
			[{ status: "forbidden" }, 403, { error: "Só quem deve pode avisar que pagou." }],
			[{ status: "no_share" }, 404, { error: "Essa pessoa não participa desta despesa." }],
			[{ status: "invalid", error: "Escolha contas de um mesmo destinatário.", field: "items" }, 422, { error: "Escolha contas de um mesmo destinatário.", field: "items" }],
			[{ status: "all_failed" }, 409, { error: "Essas contas acabaram de mudar. Atualize e tente de novo." }],
		];
		for (const [res, code, body] of cases) {
			payBatch.mockResolvedValue(res);
			expect(await out(await json({ items: [ITEM] }))).toEqual([code, body]);
		}
	});
	it("401 sem autenticação e 500 genérico", async () => {
		requireUser.mockRejectedValueOnce(new UnauthorizedError("x"));
		expect((await json({ items: [ITEM] })).status).toBe(401);
		payBatch.mockRejectedValue(new Error("boom"));
		expect((await json({ items: [ITEM] })).status).toBe(500);
	});
});
