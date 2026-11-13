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
		const big = await upload([...PNG, ...new Array(4 * 1024 * 1024).fill(0)]);
		expect(await out(big)).toEqual([422, { error: "O comprovante pode ter no máximo 4 MB.", field: "file" }]);
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
			const codes: Record<string, string> = { no_group: "no_group", no_expense: "no_expense" };
			expect(await out(await upload(null))).toEqual([code, { error, ...(codes[status] ? { code: codes[status] } : {}) }]);
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
	it("pagamento parcial: amountCents por campo do formulário ou por JSON; ausente = undefined", async () => {
		const form = new FormData();
		form.append("file", new File([new Uint8Array(PNG)], "pix.png"));
		form.append("amountCents", "4700");
		form.append("expectedPaidCents", "0");
		expect((await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "1000" } }), ctx)).status).toBe(200);
		expect(markSelfPaid.mock.calls.at(-1)?.[2]).toMatchObject({ amountCents: 4700, expectedPaidCents: 0, file: { name: "pix.png" } });
		const json = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ amountCents: 1200, expectedPaidCents: 300 }), headers: { "content-type": "application/json", "content-length": "30" } }), ctx);
		expect(json.status).toBe(200);
		expect(markSelfPaid.mock.calls.at(-1)?.[2]).toMatchObject({ amountCents: 1200, expectedPaidCents: 300 });
		expect(markSelfPaid.mock.calls.at(-1)?.[2].file).toBeUndefined();
		await upload(PNG);
		expect(markSelfPaid.mock.calls.at(-1)?.[2].amountCents).toBeUndefined();
	});
	it("422 em amountCents inválido (decimal, zero, negativo, texto), sem chamar o repo", async () => {
		for (const bad of ["12.5", "0", "-3", "abc", "99999999999"]) {
			const form = new FormData();
			form.append("amountCents", bad);
			form.append("expectedPaidCents", "0");
			const res = await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "100" } }), ctx);
			expect([res.status, (await res.json()).field]).toEqual([422, "amountCents"]);
		}
		const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ amountCents: 1.5, expectedPaidCents: 0 }), headers: { "content-type": "application/json", "content-length": "30" } }), ctx);
		expect(res.status).toBe(422);
		expect(markSelfPaid).not.toHaveBeenCalled();
	});
	it("valor maior que o que falta (repo): 409 com a mensagem simples", async () => {
		markSelfPaid.mockResolvedValue({ status: "too_much" });
		const form = new FormData();
		form.append("amountCents", "999999");
		form.append("expectedPaidCents", "0");
		const res = await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "100" } }), ctx);
		expect([res.status, await res.json()]).toEqual([409, { error: "Esse valor é maior do que falta pagar. Atualize e tente de novo.", field: "amountCents" }]);
	});
	it("expectedPaidCents: obrigatório com amountCents e validado como inteiro >= 0; sem amountCents pode faltar", async () => {
		for (const bad of [undefined, "-1", "1.5", "x", "99999999999"]) {
			const form = new FormData();
			form.append("amountCents", "100");
			if (bad !== undefined) form.append("expectedPaidCents", bad);
			const res = await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "100" } }), ctx);
			expect([res.status, (await res.json()).field]).toEqual([422, "amountCents"]);
		}
		expect(markSelfPaid).not.toHaveBeenCalled();
		// expectedPaidCents sozinho (sem amountCents) também é 422: nunca vira "quitar o que falta"
		const alone = new FormData();
		alone.append("expectedPaidCents", "0");
		const res = await POST(new Request("http://x", { method: "POST", body: alone, headers: { "content-length": "100" } }), ctx);
		expect(res.status).toBe(422);
		expect(markSelfPaid).not.toHaveBeenCalled();
	});
	it("chave amountCents presente mas vazia/nula/inválida => 422 (nunca quitação total); só a ausência real dos dois é o pedido antigo", async () => {
		for (const v of ["", " ", "abc", "0"]) {
			const form = new FormData();
			form.append("amountCents", v);
			form.append("expectedPaidCents", "0");
			expect((await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "100" } }), ctx)).status).toBe(422);
		}
		const json = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "content-length": "60" } }), ctx);
		for (const body of [{ amountCents: null, expectedPaidCents: 0 }, { amountCents: "", expectedPaidCents: 0 }, { amountCents: 100, expectedPaidCents: null }, { amountCents: 100 }, { expectedPaidCents: 0 }]) expect((await json(body)).status).toBe(422);
		expect(markSelfPaid).not.toHaveBeenCalled();
		// ausência real dos dois: pedido antigo
		expect((await json({})).status).toBe(200);
		expect(markSelfPaid.mock.calls.at(-1)?.[2].amountCents).toBeUndefined();
		expect((await upload(PNG)).status).toBe(200);
	});
	it("corpo JSON grande demais ou sem Content-Length: 'Pedido inválido.' sem apontar campo", async () => {
		const big = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "content-type": "application/json", "content-length": "99999" } }), ctx);
		expect([big.status, await big.json()]).toEqual([422, { error: "Pedido inválido." }]);
		const noLen = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx);
		expect([noLen.status, await noLen.json()]).toEqual([422, { error: "Pedido inválido." }]);
		expect(markSelfPaid).not.toHaveBeenCalled();
	});
	it("conta mudou (stale): 409 com a mensagem simples", async () => {
		markSelfPaid.mockResolvedValue({ status: "stale" });
		const form = new FormData();
		form.append("amountCents", "100");
		form.append("expectedPaidCents", "0");
		const res = await POST(new Request("http://x", { method: "POST", body: form, headers: { "content-length": "100" } }), ctx);
		expect([res.status, await res.json()]).toEqual([409, { error: "Esta conta mudou. Atualize e confira antes de pagar de novo.", field: "amountCents" }]);
	});
});
