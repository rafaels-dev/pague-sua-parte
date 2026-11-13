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
		expect(setSharePaid).toHaveBeenCalledWith({ fake: true }, "g", "e", "u1", "u3", "paid", undefined, { fakeStore: true }, undefined, undefined);
		await patch({ status: "pending" });
		expect(setSharePaid).toHaveBeenLastCalledWith({ fake: true }, "g", "e", "u1", "u3", "pending", undefined, { fakeStore: true }, undefined, undefined);
	});
	it("404, 403 e 404 com as mensagens do contrato", async () => {
		setSharePaid.mockResolvedValue({ status: "no_group" });
		expect(await out(await patch({ status: "paid" }))).toEqual([404, { error: "Grupo não encontrado.", code: "no_group" }]);
		setSharePaid.mockResolvedValue({ status: "no_expense" });
		expect(await out(await patch({ status: "paid" }))).toEqual([404, { error: "Despesa não encontrada.", code: "no_expense" }]);
		setSharePaid.mockResolvedValue({ status: "forbidden" });
		expect(await out(await patch({ status: "paid" }))).toEqual([403, { error: "Só quem pagou a despesa ou quem administra o grupo pode marcar pagamentos." }]);
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
	it("\"Recebi só uma parte\": amountCents inteiro e positivo vai para o repo, só com status paid", async () => {
		setSharePaid.mockResolvedValue({ status: "ok", expense: { id: "e" } });
		expect((await patch({ status: "paid", amountCents: 34700, expectedPaidCents: 0 })).status).toBe(200);
		expect(setSharePaid).toHaveBeenLastCalledWith({ fake: true }, "g", "e", "u1", "u3", "paid", undefined, { fakeStore: true }, 34700, 0);
		setSharePaid.mockClear();
		for (const bad of [0, -5, 1.5, "12,50", "abc", 1e12, true, {}]) {
			const [status, body] = await out(await patch({ status: "paid", amountCents: bad, expectedPaidCents: 0 }));
			expect([status, (body as { field?: string }).field]).toEqual([422, "amountCents"]);
		}
		// todo pedido COM amountCents exige expectedPaidCents (inteiro >= 0, mesmo rigor)
		for (const bad of [undefined, null, "", -1, 1.5, "x", "1.5", true, 1e12]) expect((await patch({ status: "paid", amountCents: 100, expectedPaidCents: bad })).status).toBe(422);
		// valor junto de "pending" não faz sentido
		expect((await patch({ status: "pending", amountCents: 100, expectedPaidCents: 0 })).status).toBe(422);
		expect(setSharePaid).not.toHaveBeenCalled();
	});
	it("valor recusado pelo repo: maior que o que falta = 409 com a mensagem simples; demais = 422", async () => {
		setSharePaid.mockResolvedValue({ status: "too_much" });
		expect(await out(await patch({ status: "paid", amountCents: 999999, expectedPaidCents: 0 }))).toEqual([409, { error: "Esse valor é maior do que falta pagar. Atualize e tente de novo.", field: "amountCents" }]);
		setSharePaid.mockResolvedValue({ status: "invalid_amount" });
		expect((await patch({ status: "paid", amountCents: 5, expectedPaidCents: 0 })).status).toBe(422);
		setSharePaid.mockResolvedValue({ status: "too_many_parts" });
		expect((await patch({ status: "paid", amountCents: 5, expectedPaidCents: 0 })).status).toBe(422);
	});
	it("desfazer: expectedPaidCents é repassado (a tela nova sempre manda), opcional para cliente antigo e validado se veio", async () => {
		setSharePaid.mockResolvedValue({ status: "ok", expense: { id: "e" } });
		expect((await patch({ status: "pending", expectedPaidCents: 700 })).status).toBe(200);
		expect(setSharePaid).toHaveBeenLastCalledWith({ fake: true }, "g", "e", "u1", "u3", "pending", undefined, { fakeStore: true }, undefined, 700);
		expect((await patch({ status: "pending" })).status).toBe(200);
		expect(setSharePaid).toHaveBeenLastCalledWith({ fake: true }, "g", "e", "u1", "u3", "pending", undefined, { fakeStore: true }, undefined, undefined);
		setSharePaid.mockClear();
		for (const bad of [null, "", -1, 1.5, "x", true]) expect((await patch({ status: "pending", expectedPaidCents: bad })).status).toBe(422);
		expect(setSharePaid).not.toHaveBeenCalled();
	});
	it("desfazer com a parte mudada: 409 com a mensagem de desfazer", async () => {
		setSharePaid.mockResolvedValue({ status: "stale_undo" });
		expect(await out(await patch({ status: "pending", expectedPaidCents: 0 }))).toEqual([409, { error: "Esta conta mudou. Atualize e confira antes de desfazer." }]);
	});
	it("\"Recebi\": chave amountCents presente mas vazia/nula, ou expectedPaidCents sem amountCents => 422; paid sem nenhuma das duas segue como sempre", async () => {
		for (const body of [{ status: "paid", amountCents: null, expectedPaidCents: 0 }, { status: "paid", amountCents: "", expectedPaidCents: 0 }, { status: "paid", expectedPaidCents: 0 }, { status: "paid", amountCents: 100 }]) expect((await patch(body)).status).toBe(422);
		expect(setSharePaid).not.toHaveBeenCalled();
		setSharePaid.mockResolvedValue({ status: "ok", expense: { id: "e" } });
		expect((await patch({ status: "paid" })).status).toBe(200);
	});
	it("conta mudou (expectedPaidCents divergente no repo): 409 com a mensagem simples", async () => {
		setSharePaid.mockResolvedValue({ status: "stale" });
		expect(await out(await patch({ status: "paid", amountCents: 5, expectedPaidCents: 0 }))).toEqual([409, { error: "Esta conta mudou. Atualize e confira antes de pagar de novo.", field: "amountCents" }]);
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await patch({ status: "paid" })).status).toBe(401);
		expect(setSharePaid).not.toHaveBeenCalled();
	});
});
