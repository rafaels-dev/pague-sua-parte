import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { listCutoff, seenCutoff, markSeen, startInbox, waitInbox, countUnseen, isInboxId, markAllRead, markRead, recordInbox, safeInboxUrl, toInboxDocs, toInboxItem, UNSEEN_CAP } from "./inbox";
import type { Notice } from "./types";

const n = (o: Partial<Notice> = {}): Notice => ({ uid: "u1", title: "T", body: "B", url: "/app/grupos/g1", ...o });
const APP = "https://paguesuaparte.com.br";

describe("safeInboxUrl", () => {
	it("aceita só caminhos internos do app e do convite", () => {
		expect(safeInboxUrl("/app")).toBe("/app");
		expect(safeInboxUrl("/app/grupos/g1/despesas/e1")).toBe("/app/grupos/g1/despesas/e1");
		expect(safeInboxUrl("/convite/abc123?ir=/app/grupos/g1")).toBe("/convite/abc123?ir=/app/grupos/g1");
	});
	it("endereço absoluto do próprio app vira só o caminho", () => {
		expect(safeInboxUrl(`${APP}/app/grupos/g1`, APP)).toBe("/app/grupos/g1");
		expect(safeInboxUrl(`${APP}/app/perfil?x=1`, APP)).toBe("/app/perfil?x=1");
	});
	it("rejeita forma codificada de ponto, barra e barra invertida no CAMINHO", () => {
		for (const u of ["/app/%2e%2e/x", "/app/%2E%2E/x", "/app/a%2fb", "/app/a%2Fb", "/app/a%5cb", "/app/a%5Cb", "/convite/%2e%2e/app"]) expect(safeInboxUrl(u, APP)).toBe("/app");
	});
	it("a query aceita valor codificado legítimo (o ?ir= de share-link)", () => {
		const u = `/convite/abc123?ir=${encodeURIComponent("/app/grupos/g1/despesas/e1")}`;
		expect(safeInboxUrl(u, APP)).toBe(u);
	});
	it("rejeita # em qualquer parte da URL", () => {
		for (const u of ["/app/x#a", "/app/x?y=1#a", "/convite/abc#z"]) expect(safeInboxUrl(u, APP)).toBe("/app");
	});
	it("o caminho começa em /app ou /app/ ou /convite/, não /apple", () => {
		for (const u of ["/apple", "/app-x/y", "/conviteX/a", "/convite"]) expect(safeInboxUrl(u, APP)).toBe("/app");
	});
	it.each([
		"https://evil.example/app/x",
		"//evil.example",
		"/\\evil.example",
		"/app/../admin",
		"/app//x",
		"javascript:alert(1)",
		"/outra",
		"/appx",
		"/app/x y",
		"/app/x\n",
		"",
		42,
		null,
		undefined,
	])("%j vira /app", (v) => {
		expect(safeInboxUrl(v, APP)).toBe("/app");
	});
	it("endereço absoluto de outro site vira /app mesmo com caminho válido", () => {
		expect(safeInboxUrl("https://evil.example/app/grupos/g1", APP)).toBe("/app");
	});
	it("a leitura sanea de novo", () => {
		const d = { _id: new ObjectId(), uid: "u1", title: "t", body: "b", url: "https://evil.example", createdAt: new Date("2026-01-01T00:00:00Z") };
		expect(toInboxItem(d)).toEqual({ id: d._id.toHexString(), title: "t", body: "b", url: "/app", createdAt: "2026-01-01T00:00:00.000Z", read: false });
		expect(toInboxItem({ ...d, url: "/app/x", readAt: new Date() }).read).toBe(true);
	});
});

describe("toInboxDocs", () => {
	it("não grava aviso só de e-mail (boas-vindas)", () => {
		expect(toInboxDocs([n({ emailOnly: true }), n({ uid: "u2" })], new Date())).toHaveLength(1);
	});
	it("copia só título, texto e caminho; nada interno (nem scope)", () => {
		const secret = n({
			subject: "Assunto do e-mail",
			amountCents: 5000,
			amountLabel: "Valor",
			receipts: [{ kind: "payment", groupId: "g", expenseId: "e", targetUid: "u" }],
			receiptsOf: 1,
			list: ["a"],
			next: "x",
			scope: { kind: "group", name: "Família" },
			url: `${APP}/app/grupos/g1`,
		});
		const [d] = toInboxDocs([secret], new Date(0), APP);
		expect(d).toEqual({ uid: "u1", title: "T", body: "B", url: "/app/grupos/g1", createdAt: new Date(0) });
	});
});

describe("recordInbox", () => {
	const dbWith = (insertMany: unknown) => ({ collection: () => ({ insertMany }) }) as never;
	it("uma gravação em lote, sem ordem", async () => {
		const insertMany = vi.fn().mockResolvedValue({});
		await recordInbox(dbWith(insertMany), [n(), n({ uid: "u2" }), n({ emailOnly: true })]);
		expect(insertMany).toHaveBeenCalledTimes(1);
		expect(insertMany.mock.calls[0][0]).toHaveLength(2);
		expect(insertMany.mock.calls[0][1]).toEqual({ ordered: false });
	});
	it("só e-mail: não toca no banco", async () => {
		const insertMany = vi.fn();
		await recordInbox(dbWith(insertMany), [n({ emailOnly: true })]);
		expect(insertMany).not.toHaveBeenCalled();
	});
	it("falha de gravação nunca lança (só log sem dados)", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(recordInbox(dbWith(vi.fn().mockRejectedValue(new Error("mongodb://u:senha@h caiu"))), [n()])).resolves.toBeUndefined();
		expect(log).toHaveBeenCalledTimes(1);
		expect(String(log.mock.calls[0].join(" "))).not.toContain("senha");
		log.mockRestore();
	});
	it("o prazo vale: banco que não responde não segura", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const t0 = Date.now();
		await recordInbox(dbWith(vi.fn().mockReturnValue(new Promise(() => undefined))), [n()], { deadline: Date.now() + 100 });
		expect(Date.now() - t0).toBeLessThan(1500);
		log.mockRestore();
	});
});

describe("contagem e marcação", () => {
	it("conta só o que chegou depois de inboxSeenAt, com teto", async () => {
		const seen = new Date("2026-11-13T10:00:00Z");
		const countDocuments = vi.fn().mockResolvedValue(10);
		const db = { collection: (name: string) => (name === "users" ? { findOne: async () => ({ inboxSeenAt: seen }) } : { countDocuments }) } as never;
		expect(await countUnseen(db, "u1")).toBe(10);
		expect(countDocuments).toHaveBeenCalledWith({ uid: "u1", createdAt: { $gt: seen } }, { limit: UNSEEN_CAP });
	});
	it("sem carimbo, conta tudo da pessoa (ainda com teto)", async () => {
		const countDocuments = vi.fn().mockResolvedValue(3);
		const db = { collection: (name: string) => (name === "users" ? { findOne: async () => null } : { countDocuments }) } as never;
		expect(await countUnseen(db, "u1")).toBe(3);
		expect(countDocuments).toHaveBeenCalledWith({ uid: "u1" }, { limit: UNSEEN_CAP });
	});
	it("marcar como lido filtra pelo uid de quem pede", async () => {
		const updateOne = vi.fn().mockResolvedValue({});
		const updateMany = vi.fn().mockResolvedValue({});
		const db = { collection: () => ({ updateOne, updateMany }) } as never;
		const id = new ObjectId().toHexString();
		await markRead(db, "u1", id);
		expect(updateOne.mock.calls[0][0]).toMatchObject({ uid: "u1" });
		await markAllRead(db, "u1");
		expect(updateMany.mock.calls[0][0]).toMatchObject({ uid: "u1" });
	});
	it("valida o formato do id", () => {
		expect(isInboxId(new ObjectId().toHexString())).toBe(true);
		for (const v of ["", "abc", "x".repeat(24), 5, null, "../../etc", "a".repeat(25)]) expect(isInboxId(v)).toBe(false);
	});
});

describe("pessoa cuidada", () => {
	it("não tem caixa", async () => {
		const { generateManagedUid } = await import("@/lib/groups/helpers");
		expect(toInboxDocs([n({ uid: generateManagedUid() }), n()], new Date())).toHaveLength(1);
	});
});

describe("gravação sem atrasar", () => {
	const dbWith = (insertMany: unknown) => ({ collection: () => ({ insertMany }) }) as never;
	it("startInbox não espera o banco e nunca rejeita", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const p = startInbox(dbWith(vi.fn().mockReturnValue(new Promise(() => undefined))), [n()]);
		expect(p).toBeInstanceOf(Promise);
		await expect(startInbox(dbWith(vi.fn().mockRejectedValue(new Error("x"))), [n()])).resolves.toBeUndefined();
		await expect(startInbox(dbWith(() => { throw new Error("sync"); }), [n()])).resolves.toBeUndefined();
		log.mockRestore();
	});
	it("waitInbox: com prazo longo espera no máximo 2 s e loga só a contagem", async () => {
		vi.useFakeTimers();
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const p = waitInbox(new Promise<void>(() => undefined), Date.now() + 10_000, 3);
		await vi.advanceTimersByTimeAsync(2_001);
		await p;
		expect(log).toHaveBeenCalledWith("inbox: 3 avisos ainda sem gravar quando o prazo acabou");
		log.mockRestore();
		vi.useRealTimers();
	});
	it("waitInbox: prazo vencido com gravação pendente loga; gravação pronta não loga", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await waitInbox(new Promise<void>(() => undefined), Date.now() - 1, 2);
		expect(log).toHaveBeenCalledTimes(1);
		log.mockClear();
		const done = startInbox({ collection: () => ({ insertMany: async () => ({}) }) } as never, [n()]);
		await waitInbox(done, Date.now() + 1000, 1);
		expect(log).not.toHaveBeenCalled();
		log.mockRestore();
	});
	it("waitInbox: prazo vencido não espera; prazo curto corta; sem prazo tem teto", async () => {
		const never = new Promise<void>(() => undefined);
		let t = Date.now();
		await waitInbox(never, Date.now() - 1);
		expect(Date.now() - t).toBeLessThan(50);
		t = Date.now();
		await waitInbox(never, Date.now() + 80);
		expect(Date.now() - t).toBeLessThan(500);
		await waitInbox(undefined, undefined);
	});
});

describe("seen com corte", () => {
	it("usa min(upTo, agora) e agora quando ausente", () => {
		const now = new Date("2026-11-13T12:00:00Z");
		expect(seenCutoff(new Date("2026-11-13T11:00:00Z"), now)).toEqual(new Date("2026-11-13T11:00:00Z"));
		expect(seenCutoff(new Date("2030-01-01T00:00:00Z"), now)).toBe(now);
		expect(seenCutoff(undefined, now)).toBe(now);
	});
	it("nunca retrocede: só grava se o carimbo é menor que o corte", async () => {
		const updateOne = vi.fn().mockResolvedValue({});
		const db = { collection: () => ({ updateOne }) } as never;
		const cut = new Date("2026-11-13T11:00:00Z");
		await markSeen(db, "u1", cut, new Date("2026-11-13T12:00:00Z"));
		expect(updateOne).toHaveBeenCalledWith(
			{ _id: "u1", $or: [{ inboxSeenAt: { $exists: false } }, { inboxSeenAt: { $lt: cut } }] },
			{ $set: { inboxSeenAt: cut } },
		);
	});
});

describe("corte do GET", () => {
	it("seenUpTo tem 10 s de folga", async () => {
		const { listInbox } = await import("./inbox");
		const db = { collection: () => ({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }), countDocuments: async () => 0, findOne: async () => null }) } as never;
		const now = new Date("2026-11-13T12:00:10Z");
		expect((await listInbox(db, "u1", undefined, now)).seenUpTo).toBe("2026-11-13T12:00:00.000Z");
	});
});

describe("seenUpTo = max(aviso mais novo listado, agora - 10 s), no máximo agora", () => {
	const now = new Date("2026-11-13T12:00:00.000Z");
	const at = (msAgo: number) => ({ createdAt: new Date(now.getTime() - msAgo) });
	it("lista vazia = agora - 10 s", () => expect(listCutoff([], now)).toEqual(new Date("2026-11-13T11:59:50.000Z")));
	it("mais novo com 5 min = agora - 10 s", () => expect(listCutoff([at(300_000), at(400_000)], now)).toEqual(new Date("2026-11-13T11:59:50.000Z")));
	it("mais novo há 2 s = o createdAt dele, com milissegundos", () => {
		const d = { createdAt: new Date("2026-11-13T11:59:58.123Z") };
		expect(listCutoff([d, at(900_000)], now)).toEqual(d.createdAt);
		expect(new Date(d.createdAt.toISOString()).getTime()).toBe(d.createdAt.getTime());
	});
	it("createdAt no futuro (relógio de outra instância) não passa de agora", () => {
		expect(listCutoff([{ createdAt: new Date(now.getTime() + 60_000) }], now)).toEqual(now);
	});
	it("fim a fim: listado há 2 s fica visto depois do seen; inserido depois do corte conta 1", async () => {
		const listed = { _id: new ObjectId(), uid: "u1", title: "t", body: "b", url: "/app", createdAt: new Date(now.getTime() - 2_000) };
		const late = { ...listed, _id: new ObjectId(), createdAt: new Date(now.getTime() + 1) };
		let seenAt: Date | undefined;
		const docs = [listed];
		const db = {
			collection: (name: string) =>
				name === "users"
					? { findOne: async () => ({ inboxSeenAt: seenAt }), updateOne: async (_f: unknown, u: { $set: { inboxSeenAt: Date } }) => void (seenAt = u.$set.inboxSeenAt) }
					: {
							find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => docs }) }) }),
							countDocuments: async (f: { createdAt?: { $gt: Date } }) => docs.filter((d) => !f.createdAt || d.createdAt > f.createdAt.$gt).length,
						},
		} as never;
		const { listInbox } = await import("./inbox");
		const r = await listInbox(db, "u1", undefined, now);
		expect(r.unseen).toBe(1);
		await markSeen(db, "u1", new Date(r.seenUpTo), now);
		expect(await countUnseen(db, "u1")).toBe(0);
		docs.push(late);
		expect(await countUnseen(db, "u1")).toBe(1);
	});
});
