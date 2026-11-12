import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => ({ fakeStore: true }) }));
const getExpenseDetail = vi.fn();
const deleteExpense = vi.fn();
const editExpense = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ getExpenseDetail, deleteExpense, editExpense }));

const { GET, DELETE, PATCH } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e" }) };
beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /expenses/:eid", () => {
	it("200 / 404 do grupo / 404 da despesa", async () => {
		getExpenseDetail.mockResolvedValue({ status: "ok", expense: { id: "e" } });
		expect(await (await GET(new Request("http://x"), ctx)).json()).toEqual({ id: "e" });
		getExpenseDetail.mockResolvedValue({ status: "no_group" });
		let res = await GET(new Request("http://x"), ctx);
		expect([res.status, await res.json()]).toEqual([404, { error: "Grupo não encontrado.", code: "no_group" }]);
		getExpenseDetail.mockResolvedValue({ status: "no_expense" });
		res = await GET(new Request("http://x"), ctx);
		expect([res.status, await res.json()]).toEqual([404, { error: "Despesa não encontrada.", code: "no_expense" }]);
	});
});

describe("DELETE /expenses/:eid", () => {
	const del = (query = "") => DELETE(new Request("http://x/api/x" + query, { method: "DELETE" }), ctx);
	it("scope: padrão this, following repassado, inválido 422", async () => {
		deleteExpense.mockResolvedValue({ status: "ok", deleted: 2, kept: 1 });
		expect(await (await del("?scope=following")).json()).toEqual({ ok: true, deleted: 2, kept: 1 });
		expect(deleteExpense).toHaveBeenLastCalledWith({ fake: true }, { fakeStore: true }, "g", "e", "u1", "following");
		await del();
		expect(deleteExpense).toHaveBeenLastCalledWith({ fake: true }, { fakeStore: true }, "g", "e", "u1", "this");
		deleteExpense.mockClear();
		const res = await del("?scope=all");
		expect([res.status, await res.json()]).toEqual([422, { error: "Escopo inválido.", field: "scope" }]);
		expect(deleteExpense).not.toHaveBeenCalled();
	});
	it("200, 403, 409 e 404 com as mensagens do contrato", async () => {
		deleteExpense.mockResolvedValue({ status: "ok", deleted: 1, kept: 0 });
		expect(await (await del()).json()).toEqual({ ok: true, deleted: 1, kept: 0 });
		deleteExpense.mockResolvedValue({ status: "forbidden" });
		let res = await del();
		expect([res.status, await res.json()]).toEqual([403, { error: "Só quem lançou a despesa ou quem administra o grupo pode apagar." }]);
		deleteExpense.mockResolvedValue({ status: "has_payment" });
		res = await del();
		expect([res.status, await res.json()]).toEqual([409, { error: "Essa despesa já tem pagamento e não pode ser apagada." }]);
		deleteExpense.mockResolvedValue({ status: "no_group" });
		expect((await del()).status).toBe(404);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await del()).status).toBe(401);
		expect(deleteExpense).not.toHaveBeenCalled();
	});
});

describe("PATCH /expenses/:eid (editar)", () => {
	const body = { description: "Feira", amountCents: 4000, date: "2026-11-10", participantUids: ["u1", "u2"] };
	const patch = (b: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: typeof b === "string" ? b : JSON.stringify(b) }), ctx);
	const out = async (res: Response) => [res.status, await res.json()];
	it("200 com o detalhe e repassa quem edita e os campos", async () => {
		editExpense.mockResolvedValue({ status: "ok", expense: { id: "e", canEdit: true } });
		expect(await out(await patch(body))).toEqual([200, { id: "e", canEdit: true }]);
		expect(editExpense).toHaveBeenCalledWith({ fake: true }, { fakeStore: true }, { groupId: "g", eid: "e", uid: "u1", input: body });
	});
	it("mensagens do contrato: 404, 403 (dono ou admin), 422 e 409", async () => {
		editExpense.mockResolvedValue({ status: "no_group" });
		expect(await out(await patch(body))).toEqual([404, { error: "Grupo não encontrado.", code: "no_group" }]);
		editExpense.mockResolvedValue({ status: "no_expense" });
		expect(await out(await patch(body))).toEqual([404, { error: "Despesa não encontrada.", code: "no_expense" }]);
		editExpense.mockResolvedValue({ status: "forbidden" });
		expect(await out(await patch(body))).toEqual([403, { error: "Só quem pagou a despesa ou quem administra o grupo pode editar." }]);
		editExpense.mockResolvedValue({ status: "invalid", error: "Esse valor é pequeno demais para dividir entre tantas pessoas.", field: "amountCents" });
		expect((await patch(body)).status).toBe(422);
		editExpense.mockResolvedValue({ status: "conflict" });
		expect(await out(await patch(body))).toEqual([409, { error: "Essa despesa acabou de ser alterada. Tente de novo." }]);
	});
	it("422 para corpo inválido, sem chamar o repo; 401 sem login", async () => {
		for (const b of ["not json", {}, { ...body, date: undefined }, { ...body, amountCents: 0 }, null]) expect((await patch(b)).status).toBe(422);
		expect(editExpense).not.toHaveBeenCalled();
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await patch(body)).status).toBe(401);
	});
});
