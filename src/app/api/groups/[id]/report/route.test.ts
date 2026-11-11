import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const getGroupReport = vi.fn();
vi.mock("@/lib/reports/repo", () => ({ getGroupReport }));

const { GET } = await import("./route");
const ctx = { params: Promise.resolve({ id: "g" }) };
const get = (qs = "") => GET(new Request(`http://x/api/groups/g/report${qs}`), ctx);

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /report", () => {
	it("padrão all; repassa o período", async () => {
		getGroupReport.mockResolvedValue({ status: "ok", report: { totalCents: 1 } });
		const res = await get();
		expect([res.status, await res.json()]).toEqual([200, { totalCents: 1 }]);
		expect(getGroupReport).toHaveBeenCalledWith({ fake: true }, "g", "u1", { kind: "all" });
		await get("?period=month:2026-11");
		expect(getGroupReport).toHaveBeenLastCalledWith({ fake: true }, "g", "u1", { kind: "month", month: "2026-11" });
		await get("?period=year:2026");
		expect(getGroupReport).toHaveBeenLastCalledWith({ fake: true }, "g", "u1", { kind: "year", year: "2026" });
	});
	it("período inválido: 422 em period, sem consultar", async () => {
		const res = await get("?period=month:2026-13");
		expect([res.status, ((await res.json()) as { field: string }).field]).toEqual([422, "period"]);
		expect(getGroupReport).not.toHaveBeenCalled();
	});
	it("não membro: 404; sem sessão: 401", async () => {
		getGroupReport.mockResolvedValue({ status: "no_group" });
		expect((await get()).status).toBe(404);
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await get()).status).toBe(401);
	});
});
