import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const helpExpense = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ helpExpense }));

const { POST } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e" }) };
const post = (body?: unknown) =>
	POST(new Request("http://x", { method: "POST", ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }), ctx);
const out = async (res: Response): Promise<[number, Record<string, unknown>]> => [res.status, await res.json()];

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /expenses/:eid/help", () => {
	it("200 com o detalhe; corpo vazio ou {} ajuda como o próprio usuário", async () => {
		helpExpense.mockResolvedValue({ status: "ok", expense: { id: "e" } });
		expect(await out(await post({}))).toEqual([200, { id: "e" }]);
		expect(helpExpense).toHaveBeenCalledWith({ fake: true }, "g", "e", "u1", undefined);
		await post();
		expect(helpExpense).toHaveBeenLastCalledWith({ fake: true }, "g", "e", "u1", undefined);
		await post({ forUid: "m_vo" });
		expect(helpExpense).toHaveBeenLastCalledWith({ fake: true }, "g", "e", "u1", "m_vo");
	});
	it("mapeia os resultados do repo", async () => {
		const cases: [unknown, number, Record<string, unknown>][] = [
			[{ status: "no_group" }, 404, { error: "Grupo não encontrado.", code: "no_group" }],
			[{ status: "no_expense" }, 404, { error: "Despesa não encontrada.", code: "no_expense" }],
			[{ status: "payer" }, 403, { error: "Quem pagou a despesa não pode entrar na divisão dela." }],
			[{ status: "already", name: null }, 409, { error: "Você já participa desta despesa." }],
			[{ status: "already", name: "Vó" }, 409, { error: "Vó já participa desta despesa." }],
			[{ status: "invalid", field: "forUid", error: "x" }, 422, { error: "x", field: "forUid" }],
			[{ status: "conflict" }, 409, { error: "Essa despesa acabou de ser alterada. Tente de novo." }],
		];
		for (const [res, status, body] of cases) {
			helpExpense.mockResolvedValue(res);
			expect(await out(await post({}))).toEqual([status, body]);
		}
	});
	it("422 em forUid para corpo inválido, sem chamar o repo", async () => {
		for (const body of ["not json", { forUid: 1 }, { forUid: "" }, { forUid: "   " }, [], null]) {
			const [status, json] = await out(await post(body));
			expect([status, json.field]).toEqual([422, "forUid"]);
		}
		expect(helpExpense).not.toHaveBeenCalled();
	});
	it("sem sessão: 401", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await post({})).status).toBe(401);
	});
});
