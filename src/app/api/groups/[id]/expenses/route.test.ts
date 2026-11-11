import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store }));
const createExpense = vi.fn();
const listExpenses = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ createExpense, listExpenses }));

const { GET, POST } = await import("./route");
const GID = "507f1f77bcf86cd799439011";
const ctx = { params: Promise.resolve({ id: GID }) };
const PDF = new TextEncoder().encode("%PDF-1.7 hello");
const EXE = new TextEncoder().encode("MZ\x90\0\x03\0\0\0");
const data = { description: "Mercado", amountCents: 3000, participantUids: ["u2"] };

function post(d: unknown, files: { name: string; type?: string; bytes: Uint8Array | number }[] = [], headers: Record<string, string> = {}) {
	const form = new FormData();
	form.set("data", typeof d === "string" ? d : JSON.stringify(d));
	for (const f of files) {
		const bytes = typeof f.bytes === "number" ? new Uint8Array(f.bytes) : f.bytes;
		if (typeof f.bytes === "number") bytes.set(PDF);
		form.append("files", new File([bytes as BlobPart], f.name, { type: f.type ?? "application/octet-stream" }));
	}
	return POST(new Request("http://x/api/groups/" + GID + "/expenses", { method: "POST", body: form, headers }), ctx);
}

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	createExpense.mockResolvedValue({ status: "ok", expense: { id: "e1" } });
});

describe("POST /api/groups/:id/expenses", () => {
	it("201 com o detalhe; passa arquivos já identificados pelo conteúdo", async () => {
		const res = await post(data, [{ name: "foto.jpg", type: "image/jpeg", bytes: PDF }]);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ id: "e1" });
		const args = createExpense.mock.calls[0][2];
		expect(args).toMatchObject({ groupId: GID, uid: "u1", files: [{ name: "foto.jpg", contentType: "application/pdf" }] });
		expect(createExpense.mock.calls[0][1]).toBe(store);
	});
	it("415 para executável declarado como image/png", async () => {
		const res = await post(data, [{ name: "a.png", type: "image/png", bytes: EXE }]);
		expect(res.status).toBe(415);
		expect(await res.json()).toEqual({ error: "Só aceitamos foto (JPG, PNG, WebP) ou PDF.", field: "files" });
		expect(createExpense).not.toHaveBeenCalled();
	});
	it("413 para arquivo acima de 5 MB", async () => {
		const res = await post(data, [{ name: "a.pdf", bytes: 5 * 1024 * 1024 + 1 }]);
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({ error: "Cada anexo pode ter no máximo 5 MB.", field: "files" });
	});
	it("422 para mais de 3 arquivos", async () => {
		const res = await post(data, Array.from({ length: 4 }, () => ({ name: "a.pdf", bytes: PDF })));
		expect(res.status).toBe(422);
		expect(((await res.json()) as { field: string }).field).toBe("files");
	});
	it("413 antecipado pelo Content-Length", async () => {
		const res = await post(data, [], { "content-length": String(50 * 1024 * 1024) });
		expect(res.status).toBe(413);
	});
	it.each([
		["description", { ...data, description: " " }],
		["amountCents", { ...data, amountCents: 0 }],
		["date", { ...data, date: "1999-01-01" }],
		["participantUids", { ...data, participantUids: [] }],
	])("422 com field %s", async (field, body) => {
		const res = await post(body);
		expect(res.status).toBe(422);
		expect(((await res.json()) as { field: string }).field).toBe(field);
		expect(createExpense).not.toHaveBeenCalled();
	});
	it("422 com JSON quebrado em data", async () => {
		expect((await post("{nao-json")).status).toBe(422);
	});
	it("mapeia os resultados do repositório", async () => {
		createExpense.mockResolvedValue({ status: "no_group" });
		let res = await post(data);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Grupo não encontrado." });
		createExpense.mockResolvedValue({ status: "no_pix" });
		res = await post(data);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "Cadastre sua chave Pix antes de lançar uma despesa.", field: "pixKey" });
		createExpense.mockResolvedValue({ status: "invalid", field: "participantUids", error: "x" });
		res = await post(data);
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual({ error: "x", field: "participantUids" });
	});
	it("401 sem autenticação e 500 genérico sem vazar detalhes", async () => {
		requireUser.mockRejectedValueOnce(new UnauthorizedError("x"));
		expect((await post(data)).status).toBe(401);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		createExpense.mockRejectedValue(new Error("mongodb://segredo"));
		const res = await post(data);
		expect(res.status).toBe(500);
		expect(JSON.stringify(await res.json())).not.toContain("segredo");
	});
});

describe("GET /api/groups/:id/expenses", () => {
	const get = () => GET(new Request("http://x"), ctx);
	it("200 com a lista", async () => {
		listExpenses.mockResolvedValue([{ id: "e1" }]);
		expect(await (await get()).json()).toEqual({ expenses: [{ id: "e1" }] });
		expect(listExpenses).toHaveBeenCalledWith({ fake: true }, GID, "u1");
	});
	it("404 para não membro", async () => {
		listExpenses.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Grupo não encontrado." });
	});
});

describe("POST /api/groups/:id/expenses: paidByUid", () => {
	it("repassa paidByUid ao repo; o uid do chamador vem sempre da sessão", async () => {
		await post({ ...data, paidByUid: "m_ben", uid: "invasor" });
		expect(createExpense.mock.calls[0][2]).toMatchObject({ uid: "u1", input: { paidByUid: "m_ben" } });
		expect(createExpense.mock.calls[0][2].input).not.toHaveProperty("uid");
	});
	it("422 paidByUid inválido do repo", async () => {
		createExpense.mockResolvedValue({ status: "invalid", field: "paidByUid", error: "Você só pode lançar despesas pagas por você ou por quem você cuida." });
		const res = await post({ ...data, paidByUid: "m_alheio" });
		expect(res.status).toBe(422);
		expect(((await res.json()) as { field: string }).field).toBe("paidByUid");
	});
	it("422 paidByUid com tipo errado", async () => {
		const res = await post({ ...data, paidByUid: 5 });
		expect(res.status).toBe(422);
		expect(((await res.json()) as { field: string }).field).toBe("paidByUid");
		expect(createExpense).not.toHaveBeenCalled();
	});
	it("409 sem Pix da pessoa sem login traz o nome", async () => {
		createExpense.mockResolvedValue({ status: "no_pix", name: "Benjamim" });
		const res = await post({ ...data, paidByUid: "m_ben" });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "Cadastre a chave Pix de Benjamim antes de lançar uma despesa paga por ele(a).", field: "pixKey" });
	});
	it("409 sem Pix próprio mantém a mensagem de sempre", async () => {
		createExpense.mockResolvedValue({ status: "no_pix" });
		expect(await (await post(data)).json()).toEqual({ error: "Cadastre sua chave Pix antes de lançar uma despesa.", field: "pixKey" });
	});
});
