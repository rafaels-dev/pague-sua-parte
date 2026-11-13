import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store }));
const advanceInstallments = vi.fn();
const getAdvancePlan = vi.fn();
vi.mock("@/lib/payments/advance-repo", () => ({ advanceInstallments, getAdvancePlan }));
const afterAdvance = vi.fn();
vi.mock("@/lib/notifications/events", () => ({ afterAdvance }));

const { GET, POST } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e" }) };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2];
const RID = "r_0123456789abcdef01234567";
const good = { shareUid: "u3", mode: "self", amountCents: 34700, expectedDueCents: 100000, recipientId: RID };
const json = (body: unknown, headers: Record<string, string> = {}) =>
	POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", "content-length": "500", ...headers } }), ctx);
const multipart = (fields: Record<string, string | null>, bytes?: number[], name = "pix.png") => {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) if (v !== null) form.append(k, v);
	if (bytes) form.append("file", new File([new Uint8Array(bytes)], name));
	return POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }), ctx);
};
const out = async (res: Response) => [res.status, await res.json()];

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	advanceInstallments.mockResolvedValue({ status: "ok", expense: { id: "e" }, advance: { totalCents: 34700 }, fact: { f: 1 } });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /expenses/:eid/advance", () => {
	it("200 em JSON: o repo recebe só os quatro campos; o aviso sai uma vez", async () => {
		expect(await out(await json(good))).toEqual([200, { expense: { id: "e" }, advance: { totalCents: 34700 } }]);
		expect(advanceInstallments.mock.calls[0][2]).toEqual({ groupId: "g", eid: "e", uid: "u1", shareUid: "u3", mode: "self", amountCents: 34700, expectedDueCents: 100000, recipientId: RID, file: undefined });
		expect(afterAdvance).toHaveBeenCalledWith({ f: 1 });
	});

	it("o cliente não consegue mandar a divisão: campos extras são ignorados", async () => {
		await json({ ...good, allocations: [{ id: "x", cents: 999999 }], items: [1], userId: "outro" });
		expect(Object.keys(advanceInstallments.mock.calls[0][2]).sort()).toEqual(["amountCents", "eid", "expectedDueCents", "file", "groupId", "mode", "recipientId", "shareUid", "uid"]);
		expect(advanceInstallments.mock.calls[0][2].uid).toBe("u1");
	});

	it("200 em multipart com comprovante farejado", async () => {
		const res = await multipart({ shareUid: "u3", mode: "manual", amountCents: "34700", expectedDueCents: "100000", recipientId: RID }, PNG);
		expect(res.status).toBe(200);
		expect(advanceInstallments.mock.calls[0][2]).toMatchObject({ mode: "manual", amountCents: 34700, file: { name: "pix.png", contentType: "image/png" } });
	});

	it("entradas hostis nos campos numéricos: 422 e o repo nunca é chamado", async () => {
		const hostile: unknown[] = [0, -1, 1.5, "1e3", "0x10", " 100", "100 ", "+100", "-100", "１００", "", null, true, [], {}, 1_000_000_001, 2 ** 60, "99999999999", Number.MAX_SAFE_INTEGER + 2, "abc"];
		for (const v of hostile) {
			const res = await json({ ...good, amountCents: v });
			expect([res.status, ((await res.json()) as { field: string }).field]).toEqual([422, "amountCents"]);
			const res2 = await json({ ...good, expectedDueCents: v === 0 ? -1 : v });
			expect([res2.status, ((await res2.json()) as { field: string }).field]).toEqual([422, "expectedDueCents"]);
		}
		expect(advanceInstallments).not.toHaveBeenCalled();
	});

	it("recipientId obrigatório e em formato fixo (r_ + 24 hex): o resto é 422", async () => {
		for (const v of [undefined, null, "", "r_xyz", "r_0123456789ABCDEF01234567", `${RID}0`, ` ${RID}`, 5, ["x"], { a: 1 }]) {
			const res = await json({ ...good, recipientId: v });
			expect([res.status, ((await res.json()) as { field: string }).field]).toEqual([422, "recipientId"]);
		}
		expect(advanceInstallments).not.toHaveBeenCalled();
	});

	it("chaves ausentes, modo e pessoa inválidos: 422", async () => {
		const { amountCents: _a, ...semValor } = good;
		void _a;
		const { expectedDueCents: _e, ...semTotal } = good;
		void _e;
		expect((await json(semValor)).status).toBe(422);
		expect((await json(semTotal)).status).toBe(422);
		for (const mode of ["admin", "", null, 1, "SELF"]) expect(await out(await json({ ...good, mode }))).toEqual([422, { error: "Pedido inválido.", field: "mode" }]);
		for (const shareUid of ["", null, 5, "x".repeat(201), ["a"]]) expect((await json({ ...good, shareUid })).status).toBe(422);
		expect((await json("não é json")).status).toBe(422);
		expect((await json("[1,2]")).status).toBe(422);
		expect((await json("null")).status).toBe(422);
		expect(advanceInstallments).not.toHaveBeenCalled();
	});

	it("multipart: campos que são arquivo ou ausentes, tipo não aceito e mais de um arquivo", async () => {
		expect((await multipart({ shareUid: "u3", mode: "self", amountCents: null, expectedDueCents: "1" })).status).toBe(422);
		const form = new FormData();
		form.append("shareUid", "u3");
		form.append("mode", "self");
		form.append("amountCents", new File([new Uint8Array(PNG)], "x.png"));
		form.append("expectedDueCents", "1");
		expect((await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }), ctx)).status).toBe(422);
		expect(await out(await multipart(good as never, [1, 2, 3, 4], "x.exe"))).toEqual([422, { error: "Só aceitamos foto (JPG, PNG, WebP) ou PDF.", field: "file" }]);
		const two = new FormData();
		for (const [k, v] of Object.entries({ shareUid: "u3", mode: "self", amountCents: "1", expectedDueCents: "1", recipientId: RID })) two.append(k, v);
		two.append("file", new File([new Uint8Array(PNG)], "a.png"));
		two.append("file", new File([new Uint8Array(PNG)], "b.png"));
		const res = await POST(new Request("http://x", { method: "POST", body: two, headers: { "content-length": "1000" } }), ctx);
		expect([res.status, ((await res.json()) as { field: string }).field]).toEqual([422, "file"]);
		expect(advanceInstallments).not.toHaveBeenCalled();
	});

	it("recusa corpo sem Content-Length ou grande demais e tipo de conteúdo desconhecido", async () => {
		const noLen = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(good), headers: { "content-type": "application/json" } }), ctx);
		expect(noLen.status).toBe(422);
		expect((await json(good, { "content-length": "5000" })).status).toBe(422);
		const form = new FormData();
		form.append("shareUid", "u3");
		const big = await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": String(10 * 1024 * 1024) } }), ctx);
		expect([big.status, ((await big.json()) as { field: string }).field]).toEqual([422, "file"]);
		expect((await POST(new Request("http://x", { method: "POST", body: "x", headers: { "content-type": "text/plain", "content-length": "1" } }), ctx)).status).toBe(422);
		expect(advanceInstallments).not.toHaveBeenCalled();
	});

	it("mapeia os resultados do repositório (404 iguais, 403, 409 'Os valores mudaram', 422)", async () => {
		const cases: [string, number, string, string?][] = [
			["no_group", 404, "Grupo não encontrado.", "no_group"],
			["no_expense", 404, "Despesa não encontrada.", "no_expense"],
			["not_installment", 422, "Esta despesa não é parcelada."],
			["forbidden", 403, "Só quem deve pode avisar que pagou."],
			["no_share", 404, "Essa pessoa não participa desta despesa."],
			["conflict", 409, "Essa compra acabou de ser alterada. Tente de novo."],
			["stale", 409, "Os valores mudaram. Atualize e confira antes de pagar."],
			["recipient_changed", 409, "A chave Pix de quem recebe mudou. Volte e confira de novo."],
			["uncertain", 409, "Parte do pagamento pode ter sido registrada. Atualize a tela e confira antes de pagar de novo.", "advance_uncertain"],
			["invalid_amount", 422, "Digite um valor válido."],
			["too_much", 422, "Esse valor é maior do que falta pagar na compra. Atualize e tente de novo."],
			["too_many_parts", 422, "Essa parte já teve pagamentos demais. Pague o que falta de uma vez."],
		];
		for (const [status, code, error, c] of cases) {
			advanceInstallments.mockResolvedValue({ status });
			const [s, body] = (await out(await json(good))) as [number, { error: string; code?: string }];
			expect([s, body.error, body.code]).toEqual([code, error, c]);
		}
		advanceInstallments.mockResolvedValue({ status: "forbidden" });
		expect(((await (await json({ ...good, mode: "manual" })).json()) as { error: string }).error).toContain("Só quem pagou a despesa");
		expect(afterAdvance).not.toHaveBeenCalled();
	});

	it("gravou mas sem detalhe da despesa: continua 200 e o aviso sai", async () => {
		advanceInstallments.mockResolvedValue({ status: "ok", expense: null, advance: { totalCents: 1 }, fact: { f: 2 } });
		expect(await out(await json(good))).toEqual([200, { expense: null, advance: { totalCents: 1 } }]);
		expect(afterAdvance).toHaveBeenCalledWith({ f: 2 });
	});

	it("401 sem autenticação e 500 genérico em erro", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await json(good)).status).toBe(401);
		requireUser.mockResolvedValue({ uid: "u1" });
		advanceInstallments.mockRejectedValue(new Error("boom"));
		expect((await json(good)).status).toBe(500);
	});
});

describe("GET /expenses/:eid/advance", () => {
	const get = (qs: string) => GET(new Request(`http://x/advance${qs}`), ctx);
	it("200 com o plano, sem cache", async () => {
		getAdvancePlan.mockResolvedValue({ status: "ok", plan: { shareUid: "u3", totalDueCents: 5 } });
		const res = await get("?shareUid=u3");
		expect([res.status, res.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
		expect(getAdvancePlan.mock.calls[0].slice(2)).toEqual(["e", "u1", "u3", "self"]);
		await get("?shareUid=u3&mode=manual");
		expect(getAdvancePlan.mock.calls[1].slice(2)).toEqual(["e", "u1", "u3", "manual"]);
		expect((await get("?shareUid=u3&mode=admin")).status).toBe(422);
		getAdvancePlan.mockResolvedValue({ status: "forbidden" });
		expect((await get("?shareUid=u3&mode=manual")).status).toBe(403);
	});
	it("422 sem shareUid, e 404 iguais", async () => {
		expect((await get("")).status).toBe(422);
		expect((await get(`?shareUid=${"x".repeat(201)}`)).status).toBe(422);
		getAdvancePlan.mockResolvedValue({ status: "no_group" });
		expect(await out(await get("?shareUid=u3"))).toEqual([404, { error: "Grupo não encontrado.", code: "no_group" }]);
		getAdvancePlan.mockResolvedValue({ status: "no_expense" });
		expect((await get("?shareUid=u3")).status).toBe(404);
		getAdvancePlan.mockResolvedValue({ status: "not_installment" });
		expect((await get("?shareUid=u3")).status).toBe(422);
	});
});
