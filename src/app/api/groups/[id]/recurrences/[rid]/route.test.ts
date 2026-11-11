import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const updateRecurrence = vi.fn();
const endRecurrence = vi.fn();
vi.mock("@/lib/recurrences/repo", () => ({ updateRecurrence, endRecurrence }));

const { PATCH, DELETE } = await import("./route");
const GID = "507f1f77bcf86cd799439011";
const ctx = { params: Promise.resolve({ id: GID, rid: "607f1f77bcf86cd799439011" }) };
const patch = (b: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: typeof b === "string" ? b : JSON.stringify(b) }), ctx);
const del = () => DELETE(new Request("http://x", { method: "DELETE" }), ctx);

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
});

describe("PATCH /api/groups/:id/recurrences/:rid", () => {
	it("200 com a despesa fixa atualizada", async () => {
		updateRecurrence.mockResolvedValue({ status: "ok", recurrence: { id: "r1" } });
		const res = await patch({ amountCents: 200, endPeriod: null });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "r1" });
		expect(updateRecurrence.mock.calls[0][1]).toMatchObject({ groupId: GID, rid: "607f1f77bcf86cd799439011", uid: "u1", patch: { amountCents: 200, endPeriod: null } });
	});
	it("422 para corpo inválido ou vazio", async () => {
		expect((await patch("{")).status).toBe(422);
		expect((await patch({})).status).toBe(422);
		expect((await patch({ dayOfMonth: 99 })).status).toBe(422);
		expect(updateRecurrence).not.toHaveBeenCalled();
	});
	it("404, 403 e 422 do repo", async () => {
		updateRecurrence.mockResolvedValueOnce({ status: "no_group" });
		expect((await patch({ amountCents: 1 })).status).toBe(404);
		updateRecurrence.mockResolvedValueOnce({ status: "no_recurrence" });
		expect((await patch({ amountCents: 1 })).status).toBe(404);
		updateRecurrence.mockResolvedValueOnce({ status: "forbidden" });
		expect((await patch({ amountCents: 1 })).status).toBe(403);
		updateRecurrence.mockResolvedValueOnce({ status: "invalid", field: "participantUids", error: "x" });
		const res = await patch({ amountCents: 1 });
		expect([res.status, ((await res.json()) as { field: string }).field]).toEqual([422, "participantUids"]);
	});
});

describe("DELETE /api/groups/:id/recurrences/:rid", () => {
	it("200 { ok: true }", async () => {
		endRecurrence.mockResolvedValue({ status: "ok" });
		const res = await del();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
	it("404, 403 e 401", async () => {
		endRecurrence.mockResolvedValueOnce({ status: "no_recurrence" });
		expect((await del()).status).toBe(404);
		endRecurrence.mockResolvedValueOnce({ status: "forbidden" });
		expect((await del()).status).toBe(403);
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await del()).status).toBe(401);
	});
});
