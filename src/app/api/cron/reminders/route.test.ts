import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn(async () => ({ planned: 3, sent: 2, failed: 1, duplicates: 0, skipped: 4, stoppedEarly: false, channels: true }));
vi.mock("@/lib/reminders/run", () => ({ runReminders: () => run() }));
vi.mock("@/lib/db/client", () => ({ getDb: async () => ({}) }));
const route = await import("./route");
const { GET } = route;
const { isCronAuthorized } = await import("@/lib/api/cron-auth");

const SECRET = "segredo-de-teste-0123456789";
const call = (auth?: string) => GET(new Request("http://x.test/api/cron/reminders", { headers: auth ? { authorization: auth } : {} }));
const SAVED = process.env.CRON_SECRET;
beforeEach(() => {
	process.env.CRON_SECRET = SECRET;
	run.mockClear();
});
afterEach(() => {
	if (SAVED === undefined) delete process.env.CRON_SECRET;
	else process.env.CRON_SECRET = SAVED;
});

describe("GET /api/cron/reminders", () => {
	it("segredo certo: roda e devolve só contagens", async () => {
		const res = await call(`Bearer ${SECRET}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, planned: 3, sent: 2, failed: 1, duplicates: 0, skipped: 4, stoppedEarly: false, channels: true });
		expect(res.headers.get("cache-control")).toBe("no-store");
	});
	for (const [name, auth] of [["segredo errado", "Bearer outro-segredo-1234567890"], ["sem cabeçalho", undefined], ["sem 'Bearer'", SECRET], ["Basic", `Basic ${SECRET}`], ["vazio", "Bearer "]] as const) {
		it(`${name}: 401 sem detalhe e nada roda`, async () => {
			const res = await call(auth);
			expect(res.status).toBe(401);
			expect(await res.text()).toBe("Unauthorized");
			expect(run).not.toHaveBeenCalled();
		});
	}
	it("sem CRON_SECRET configurado, recusa tudo (até 'Bearer undefined' e 'Bearer ')", async () => {
		delete process.env.CRON_SECRET;
		for (const a of ["Bearer undefined", "Bearer ", "Bearer", undefined]) expect((await call(a)).status).toBe(401);
		expect(run).not.toHaveBeenCalled();
	});
	it("falha interna: 500 sem dados", async () => {
		run.mockRejectedValueOnce(new Error("segredo p@q.com"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await call(`Bearer ${SECRET}`);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ ok: false });
	});
	it("segredo curto demais nunca vale (mesmo igual)", () => {
		expect(isCronAuthorized("Bearer abc", "abc")).toBe(false);
	});
});

describe("outros métodos e respostas 401", () => {
	const url = "http://x.test/api/cron/reminders";
	it("POST, PUT, PATCH, DELETE, HEAD e OPTIONS não executam a lógica, nem com o segredo certo", async () => {
		for (const name of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const) {
			const res = await route[name]();
			expect(res.status, name).toBe(405);
			expect(res.headers.get("allow")).toBe("GET");
		}
		expect(run).not.toHaveBeenCalled();
	});
	it("a rota só exporta GET como método que trabalha", () => {
		expect(typeof route.GET).toBe("function");
		for (const name of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const) expect(route[name]).not.toBe(route.GET);
	});
	it("a resposta 401 é idêntica em todos os casos (corpo, status e cabeçalhos)", async () => {
		delete process.env.CRON_SECRET;
		const semSegredo = await GET(new Request(url, { headers: { authorization: "Bearer qualquer-coisa-123456" } }));
		process.env.CRON_SECRET = SECRET;
		const casos = [undefined, "Bearer errado-errado-errado", "Basic abc", SECRET, "Bearer"];
		const rs = [semSegredo, ...(await Promise.all(casos.map((a) => call(a))))];
		const dump = async (r: Response) => JSON.stringify([r.status, await r.text(), [...r.headers].sort()]);
		const dumps = await Promise.all(rs.map(dump));
		for (const d of dumps) expect(d).toBe(dumps[0]);
		expect(rs[0].status).toBe(401);
	});
});

