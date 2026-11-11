import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const setSharePaid = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ setSharePaid }));
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => ({ fakeStore: true }) }));

const { PATCH } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e", uid: "u3" }) };
const patch = (body: unknown) =>
	PATCH(new Request("http://x", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), ctx);
const out = async (res: Response) => [res.status, await res.json()];

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("PATCH /expenses/:eid/shares/:uid", () => {
	it("200 com o detalhe e repassa os argumentos", async () => {
		setSharePaid.mockResolvedValue({ status: "ok", expense: { id: "e", canMarkPaid: true } });
		expect(await out(await patch({ status: "paid" }))).toEqual([200, { id: "e", canMarkPaid: true }]);
		expect(setSharePaid).toHaveBeenCalledWith({ fake: true }, "g", "e", "u1", "u3", "paid", undefined, { fakeStore: true });
		await patch({ status: "pending" });
		expect(setSharePaid).toHaveBeenLastCalledWith({ fake: true }, "g", "e", "u1", "u3", "pending", undefined, { fakeStore: true });
	});
	it("404, 403 e 404 com as mensagens do contrato", async () => {
		setSharePaid.mockResolvedValue({ status: "no_group" });
		expect(await out(await patch({ status: "paid" }))).toEqual([404, { error: "Grupo não encontrado." }]);
		setSharePaid.mockResolvedValue({ status: "no_expense" });
		expect(await out(await patch({ status: "paid" }))).toEqual([404, { error: "Despesa não encontrada." }]);
		setSharePaid.mockResolvedValue({ status: "forbidden" });
		expect(await out(await patch({ status: "paid" }))).toEqual([403, { error: "Só quem pagou a despesa pode marcar pagamentos." }]);
		setSharePaid.mockResolvedValue({ status: "no_share" });
		expect(await out(await patch({ status: "paid" }))).toEqual([404, { error: "Essa pessoa não participa desta despesa." }]);
	});
	it("409 quando perde a corrida de edição", async () => {
		setSharePaid.mockResolvedValue({ status: "conflict" });
		expect(await out(await patch({ status: "paid" }))).toEqual([409, { error: "Essa despesa acabou de ser alterada. Tente de novo." }]);
	});
	it("422 para corpo inválido, sem chamar o repo", async () => {
		for (const body of ["not json", {}, { status: "payer" }, { status: 1 }, null]) {
			expect((await patch(body)).status).toBe(422);
		}
		expect(setSharePaid).not.toHaveBeenCalled();
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await patch({ status: "paid" })).status).toBe(401);
		expect(setSharePaid).not.toHaveBeenCalled();
	});
});
