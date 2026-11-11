import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const createRecurrence = vi.fn();
const listRecurrences = vi.fn();
vi.mock("@/lib/recurrences/repo", () => ({ createRecurrence, listRecurrences }));

const { GET, POST } = await import("./route");
const GID = "507f1f77bcf86cd799439011";
const ctx = { params: Promise.resolve({ id: GID }) };
const body = { description: "Aluguel", amountCents: 150000, dayOfMonth: 25, participantMode: "all" };
const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) }), ctx);
const item = { id: "r1", description: "Aluguel" };

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("GET /api/groups/:id/recurrences", () => {
	it("lista", async () => {
		listRecurrences.mockResolvedValue([item]);
		const res = await GET(new Request("http://x"), ctx);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ recurrences: [item] });
		expect(listRecurrences).toHaveBeenCalledWith({ fake: true }, GID, "u1");
	});
	it("404 para quem não é do grupo; 401 sem sessão", async () => {
		listRecurrences.mockResolvedValue(null);
		expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
	});
});

describe("POST /api/groups/:id/recurrences", () => {
	it("201 com a despesa fixa e firstExpenseId", async () => {
		createRecurrence.mockResolvedValue({ status: "ok", recurrence: item, firstExpenseId: "e1" });
		const res = await post(body);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ ...item, firstExpenseId: "e1" });
		expect(createRecurrence.mock.calls[0][1]).toMatchObject({ groupId: GID, uid: "u1", input: { dayOfMonth: 25, participantMode: "all" } });
	});
	it("422 para corpo inválido, sem chamar o repo", async () => {
		for (const [b, field] of [["{", "description"], [{ ...body, dayOfMonth: 40 }, "dayOfMonth"], [{ ...body, participantMode: "x" }, "participantMode"]] as const) {
			const res = await post(b);
			expect(res.status).toBe(422);
			expect(((await res.json()) as { field: string }).field).toBe(field);
		}
		expect(createRecurrence).not.toHaveBeenCalled();
	});
	it("409 sem chave Pix (com e sem nome), 404 e 422 do repo", async () => {
		createRecurrence.mockResolvedValueOnce({ status: "no_pix" });
		let res = await post(body);
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ field: "pixKey", error: "Cadastre sua chave Pix antes de lançar uma despesa." });
		createRecurrence.mockResolvedValueOnce({ status: "no_pix", name: "Vó" });
		res = await post(body);
		expect(((await res.json()) as { error: string }).error).toContain("Vó");
		createRecurrence.mockResolvedValueOnce({ status: "no_group" });
		expect((await post(body)).status).toBe(404);
		createRecurrence.mockResolvedValueOnce({ status: "invalid", field: "paidByUid", error: "x" });
		res = await post(body);
		expect([res.status, ((await res.json()) as { field: string }).field]).toEqual([422, "paidByUid"]);
	});
});
