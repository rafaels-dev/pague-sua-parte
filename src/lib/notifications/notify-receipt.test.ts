import type { Db } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 7, 7]);
const getReceiptRef = vi.fn();
vi.mock("@/lib/expenses/repo", () => ({ getReceiptRef: (...a: unknown[]) => getReceiptRef(...a) }));
const storeGet = vi.fn();
vi.mock("@/lib/storage/attachments", () => ({
	getAttachmentStore: () => ({
		get: async () => (storeGet(), ({ body: new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(PDF), c.close()) }), size: PDF.byteLength })),
	}),
}));
const { notify } = await import("./notify");

const fakeDb = (users: object[]) =>
	({ collection: () => ({ find: () => ({ toArray: async () => users }) }) }) as unknown as Db;
const user = (id: string) => ({ _id: id, email: `${id}@x.test`, emailVerified: true });
const base = { title: "Pagamento recebido", subject: "Bia pagou R$ 10,00", body: "Bia pagou.", url: "/app/x", scope: { kind: "group" as const, name: "G" }, receipts: [{ groupId: "g", expenseId: "e", targetUid: "bia", kind: "payment" as const }] };
const SAVED = { ...process.env };

beforeEach(() => {
	Object.assign(process.env, { MAILGUN_SENDING_KEY: "k", MAILGUN_DOMAIN: "mg.x.test", EMAIL_FROM: "A <a@mg.x.test>" });
	delete process.env.VAPID_PRIVATE_KEY;
	getReceiptRef.mockReset();
	storeGet.mockClear();
});
afterEach(() => {
	vi.restoreAllMocks();
	process.env = { ...SAVED };
});

const sent = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => (c[1] as RequestInit).body as FormData | string);

describe("e-mail com comprovante em anexo", () => {
	it("quem pode baixar recebe multipart com o arquivo e a linha 'em anexo'; a referência não aparece no corpo", async () => {
		getReceiptRef.mockResolvedValue({ status: "ok", key: "receipts/g/e/x", name: "meu comprovante.pdf", contentType: "application/pdf" });
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		await notify(fakeDb([user("bia")]), [{ uid: "bia", ...base }]);
		expect(f).toHaveBeenCalledTimes(1);
		expect(getReceiptRef).toHaveBeenCalledWith(expect.anything(), "g", "e", "bia", "bia", "payment", undefined); // o destinatário é quem pede
		const body = sent(f)[0] as FormData;
		expect(body).toBeInstanceOf(FormData);
		const file = body.get("attachment") as File;
		expect(file.name).toBe("meu_comprovante.pdf");
		expect(file.type).toBe("application/pdf");
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF);
		expect(body.getAll("attachment")).toHaveLength(1);
		expect(body.get("o:tracking")).toBe("no");
		expect(body.get("to")).toBe("bia@x.test");
		expect(body.get("subject")).toBe("Bia pagou R$ 10,00");
		expect(String(body.get("html"))).toContain("O comprovante está em anexo.");
		expect(String(body.get("text"))).toContain("O comprovante está em anexo.");
		expect(`${body.get("html")}${body.get("text")}`).not.toMatch(/receipts\/|targetUid/);
		expect((f.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty("Content-Type"); // o fetch põe o boundary
	});

	it("quem NÃO poderia baixar recebe o e-mail sem anexo e sem a linha", async () => {
		getReceiptRef.mockResolvedValue({ status: "not_found" });
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		await notify(fakeDb([user("cid")]), [{ uid: "cid", ...base }]);
		const raw = sent(f)[0] as string;
		expect(typeof raw).toBe("string");
		expect(raw).not.toMatch(/attachment|comprovante/i);
	});

	it("o serviço recusa o pedido com anexo (413): reenvia sem arquivo, com 'Veja o comprovante no app.'", async () => {
		getReceiptRef.mockResolvedValue({ status: "ok", key: "k", name: "a.pdf", contentType: "application/pdf" });
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 413 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		await notify(fakeDb([user("bia")]), [{ uid: "bia", ...base }]);
		expect(f).toHaveBeenCalledTimes(2);
		const second = sent(f)[1] as string;
		expect(typeof second).toBe("string");
		expect(new URLSearchParams(second).get("text")).toContain("Veja o comprovante no app.");
		expect(log).not.toHaveBeenCalled();
	});

	it("429 com anexo: nova tentativa reaproveita os mesmos bytes (o arquivo é lido uma vez)", async () => {
		getReceiptRef.mockResolvedValue({ status: "ok", key: "k", name: "a.pdf", contentType: "application/pdf" });
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const p = notify(fakeDb([user("bia")]), [{ uid: "bia", ...base }]);
		await vi.advanceTimersByTimeAsync(3000);
		await p;
		vi.useRealTimers();
		expect(f).toHaveBeenCalledTimes(2);
		expect(getReceiptRef).toHaveBeenCalledTimes(1);
		for (const b of sent(f)) expect((b as FormData).get("attachment")).toBeTruthy();
	});
});

describe("notify: relatório, prazo e arquivo lido uma vez", () => {
	const ok = { status: "ok", key: "k", name: "a.pdf", contentType: "application/pdf" };
	it("lote para 4 destinatários com o mesmo comprovante: todos recebem o anexo e o arquivo é lido UMA vez", async () => {
		getReceiptRef.mockResolvedValue(ok);
		const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
		const ids = ["u1", "u2", "u3", "u4"];
		const r = await notify(fakeDb(ids.map(user)), ids.map((uid) => ({ uid, ...base })));
		expect(r).toEqual({ delivered: 4, failed: 0 });
		expect(storeGet).toHaveBeenCalledTimes(1);
		for (const b of sent(f)) expect((b as FormData).get("attachment")).toBeTruthy();
	});
	it("a permissão é conferida por destinatário mesmo com o arquivo em cache", async () => {
		getReceiptRef.mockImplementation(async (_db: unknown, _g: string, _e: string, _t: string, viewer: string) => (viewer === "u1" ? ok : { status: "not_found" }));
		const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
		await notify(fakeDb([user("u1"), user("u2")]), [{ uid: "u1", ...base }, { uid: "u2", ...base }]);
		const bodies = sent(f);
		expect(bodies.filter((b) => b instanceof FormData)).toHaveLength(1); // só u1
		expect(bodies.filter((b) => typeof b === "string")).toHaveLength(1); // u2 sem anexo
		expect(String(bodies.find((b) => typeof b === "string"))).not.toMatch(/comprovante/i);
	});
	it("relatório: entregue, falhou em todos os canais, sem canal (e-mail desligado) não conta", async () => {
		getReceiptRef.mockResolvedValue({ status: "not_found" });
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => new Response("{}", { status: String((init as RequestInit).body).includes("bad%40") ? 500 : 200 }));
		const users = [user("ok"), { ...user("bad"), email: "bad@x.test" }, { _id: "off", email: "off@x.test", emailVerified: true, notify: { email: false } }];
		const r = await notify(fakeDb(users), [{ uid: "ok", ...base }, { uid: "bad", ...base }, { uid: "off", ...base }]);
		expect(r).toEqual({ delivered: 1, failed: 1 });
	});
	it("prazo curto demais: nenhum envio começa; o aviso conta como falha", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const r = await notify(fakeDb([user("u1")]), [{ uid: "u1", ...base }], { deadline: Date.now() + 500 });
		expect(f).not.toHaveBeenCalled();
		expect(r).toEqual({ delivered: 0, failed: 1 });
		expect(log).toHaveBeenCalledWith("notify: 1 e-mails e 0 pushes ficaram de fora por falta de prazo"); // texto fixo, só números
	});
	it("com relógio simulado: o tempo limite de cada envio nunca passa do que resta do prazo", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
		const timeouts: number[] = [];
		const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => (timeouts.push(ms), new AbortController().signal));
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			vi.advanceTimersByTime(3_000); // cada envio "demora" 3 s
			return new Response("{}", { status: 200 });
		});
		getReceiptRef.mockResolvedValue({ status: "not_found" });
		const deadline = Date.now() + 7_000;
		const ids = ["a", "b", "c", "d", "e", "f"];
		const r = await notify(fakeDb(ids.map(user)), ids.map((uid) => ({ uid, ...base })), { deadline });
		vi.useRealTimers();
		spy.mockRestore();
		expect(Date.now()).toBeGreaterThan(0);
		expect(timeouts.length).toBeGreaterThan(0);
		for (const t of timeouts) expect(t).toBeLessThanOrEqual(7_000);
		expect(r.delivered + r.failed).toBe(6);
		expect(r.failed).toBeGreaterThan(0); // o que não coube no prazo nem começou
	});
});

