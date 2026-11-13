import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const listInbox = vi.fn();
const countUnseen = vi.fn();
const markSeen = vi.fn();
const markRead = vi.fn();
const markAllRead = vi.fn();
vi.mock("@/lib/notifications/inbox", async (orig) => ({ ...(await orig<typeof import("@/lib/notifications/inbox")>()), listInbox, countUnseen, markSeen, markRead, markAllRead }));

const list = await import("./route");
const count = await import("./count/route");
const seen = await import("./seen/route");
const read = await import("./read/route");

const post = (body: unknown) => new Request("http://x/api/me/inbox/read", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const ID = "0123456789abcdef01234567";

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("rotas da caixa de avisos", () => {
	it("401 sem login, em todas, sem tocar no banco", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError("x"));
		const rs = [await list.GET(new Request("http://x")), await count.GET(new Request("http://x")), await seen.POST(new Request("http://x", { method: "POST" })), await read.POST(post({ all: true }))];
		expect(rs.map((r) => r.status)).toEqual([401, 401, 401, 401]);
		expect(listInbox).not.toHaveBeenCalled();
		expect(markSeen).not.toHaveBeenCalled();
		expect(markAllRead).not.toHaveBeenCalled();
	});
	it("lista só os dados do uid do token, sem cache", async () => {
		listInbox.mockResolvedValue({ items: [], unseen: 2 });
		const res = await list.GET(new Request("http://x/api/me/inbox?uid=outro"));
		expect(await res.json()).toEqual({ items: [], unseen: 2 });
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		expect(listInbox).toHaveBeenCalledWith({ fake: true }, "u1");
	});
	it("count devolve só o contador", async () => {
		countUnseen.mockResolvedValue(10);
		const res = await count.GET(new Request("http://x"));
		expect(await res.json()).toEqual({ unseen: 10 });
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
	});
	it("seen sem corpo = agora, para o uid do token", async () => {
		countUnseen.mockResolvedValue(0);
		const res = await seen.POST(new Request("http://x", { method: "POST" }));
		expect(await res.json()).toEqual({ unseen: 0 });
		expect(markSeen).toHaveBeenCalledWith({ fake: true }, "u1", undefined);
	});
	it("seen com upTo válido passa o corte e devolve o que sobrou", async () => {
		countUnseen.mockResolvedValue(2);
		const res = await seen.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ upTo: "2026-11-13T12:00:00.000Z" }) }));
		expect(await res.json()).toEqual({ unseen: 2 });
		expect(markSeen).toHaveBeenCalledWith({ fake: true }, "u1", new Date("2026-11-13T12:00:00.000Z"));
	});
	it.each([{ upTo: "ontem" }, { upTo: 5 }, { upTo: "2026-11-13T12:00:00Z", x: 1 }, "não é json", []])("seen com upTo inválido %j = 422", async (b) => {
		const res = await seen.POST(new Request("http://x", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) }));
		expect(res.status).toBe(422);
		expect(markSeen).not.toHaveBeenCalled();
	});
	it("read: id válido vai com o uid do token (id alheio fica sem efeito no repositório)", async () => {
		const res = await read.POST(post({ id: ID }));
		expect(res.status).toBe(200);
		expect(markRead).toHaveBeenCalledWith({ fake: true }, "u1", ID);
	});
	it("read: all", async () => {
		expect((await read.POST(post({ all: true }))).status).toBe(200);
		expect(markAllRead).toHaveBeenCalledWith({ fake: true }, "u1");
	});
	it.each([{}, { id: "abc" }, { id: 5 }, { all: false }, { all: true, id: ID }, { id: ID, uid: "outro" }, "não é json", null, []])("corpo inválido %j = 422", async (b) => {
		expect((await read.POST(post(b))).status).toBe(422);
		expect(markRead).not.toHaveBeenCalled();
		expect(markAllRead).not.toHaveBeenCalled();
	});
	it("erro de banco = 500 sem detalhes", async () => {
		listInbox.mockRejectedValue(new Error("mongodb+srv://u:senha@h falhou"));
		const res = await list.GET(new Request("http://x"));
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain("senha");
	});
});
