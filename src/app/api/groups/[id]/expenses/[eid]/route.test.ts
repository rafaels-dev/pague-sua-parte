import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => ({ fakeStore: true }) }));
const getExpenseDetail = vi.fn();
const deleteExpense = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ getExpenseDetail, deleteExpense }));

const { GET, DELETE } = await import("./route");
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
		expect([res.status, await res.json()]).toEqual([404, { error: "Grupo não encontrado." }]);
		getExpenseDetail.mockResolvedValue({ status: "no_expense" });
		res = await GET(new Request("http://x"), ctx);
		expect([res.status, await res.json()]).toEqual([404, { error: "Despesa não encontrada." }]);
	});
});

describe("DELETE /expenses/:eid", () => {
	const del = () => DELETE(new Request("http://x", { method: "DELETE" }), ctx);
	it("200, 403, 409 e 404 com as mensagens do contrato", async () => {
		deleteExpense.mockResolvedValue({ status: "ok" });
		expect(await (await del()).json()).toEqual({ ok: true });
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
