import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const updateParticipants = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ updateParticipants }));

const { PUT } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g", eid: "e" }) };
const put = (body: unknown) =>
	PUT(new Request("http://x", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }), ctx);
const out = async (res: Response): Promise<[number, Record<string, unknown>]> => [res.status, await res.json()];

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("PUT /expenses/:eid/participants", () => {
	it("200 com o detalhe e repassa os argumentos", async () => {
		updateParticipants.mockResolvedValue({ status: "ok", expense: { id: "e" } });
		expect(await out(await put({ participantUids: ["u1"] }))).toEqual([200, { id: "e" }]);
		expect(updateParticipants).toHaveBeenCalledWith({ fake: true }, "g", "e", "u1", ["u1"], "this");
	});
	it("scope following é repassado; scope inválido: 422 em scope", async () => {
		updateParticipants.mockResolvedValue({ status: "ok", expense: { id: "e" } });
		await put({ participantUids: ["u1"], scope: "following" });
		expect(updateParticipants).toHaveBeenCalledWith({ fake: true }, "g", "e", "u1", ["u1"], "following");
		updateParticipants.mockClear();
		expect(await out(await put({ participantUids: ["u1"], scope: "todas" }))).toEqual([422, { error: "Escopo inválido.", field: "scope" }]);
		expect(updateParticipants).not.toHaveBeenCalled();
	});
	it("mapeia os resultados do repo", async () => {
		updateParticipants.mockResolvedValue({ status: "no_group" });
		expect(await out(await put({ participantUids: ["u1"] }))).toEqual([404, { error: "Grupo não encontrado." }]);
		updateParticipants.mockResolvedValue({ status: "no_expense" });
		expect(await out(await put({ participantUids: ["u1"] }))).toEqual([404, { error: "Despesa não encontrada." }]);
		updateParticipants.mockResolvedValue({ status: "forbidden" });
		expect(await out(await put({ participantUids: ["u1"] }))).toEqual([403, { error: "Só quem pagou a despesa pode mudar quem divide." }]);
		updateParticipants.mockResolvedValue({ status: "invalid", field: "amountCents", error: "pequeno" });
		expect(await out(await put({ participantUids: ["u1"] }))).toEqual([422, { error: "pequeno", field: "amountCents" }]);
		updateParticipants.mockResolvedValue({ status: "conflict" });
		expect(await out(await put({ participantUids: ["u1"] }))).toEqual([409, { error: "Essa despesa acabou de ser alterada. Tente de novo." }]);
	});
	it("422 em participantUids para corpo inválido, sem chamar o repo", async () => {
		for (const body of ["not json", {}, { participantUids: [] }, { participantUids: ["a", "a"] }, { participantUids: "a" }, { participantUids: [1] }, null, []]) {
			const [status, json] = await out(await put(body));
			expect(status).toBe(422);
			expect(json.field).toBe("participantUids");
		}
		expect(updateParticipants).not.toHaveBeenCalled();
	});
	it("401 sem autenticação", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		expect((await put({ participantUids: ["u1"] })).status).toBe(401);
		expect(updateParticipants).not.toHaveBeenCalled();
	});
});
