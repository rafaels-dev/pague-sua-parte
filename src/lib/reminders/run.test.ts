import { ObjectId, type Db } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notice } from "@/lib/notifications/types";
import type { RecurrenceDoc } from "@/lib/recurrences/collection";

type Report = { delivered: number; failed: number };
const notifyMock = vi.fn<(db: unknown, n: Notice[], o?: { deadline?: number }) => Promise<Report>>(async (_d, n) => ({ delivered: n.length, failed: 0 }));
vi.mock("@/lib/notifications/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notifications/notify")>()), notify: (db: unknown, n: Notice[], o?: { deadline?: number }) => notifyMock(db, n, o) }));
const { claimReminders, runReminders, MAX_REMINDERS_PER_RUN, RUN_BUDGET_MS, MIN_BATCH_START_MS, BATCH_BUDGET_MS } = await import("./run");

const GID = new ObjectId("507f1f77bcf86cd799439011");
const m = (uid: string) => ({ uid, role: "member", joinedAt: new Date() });
const rec = (i: number, o: Partial<RecurrenceDoc> = {}): RecurrenceDoc => ({
	_id: new ObjectId(`607f1f77bcf86cd7994390${String(i).padStart(2, "0")}`), groupId: GID, createdBy: "pag", paidBy: "pag", description: `Conta ${i}`, amountCents: 9000, dayOfMonth: 20,
	participantMode: "all", participantUids: [], startPeriod: "2026-01", nextPeriod: "2026-11", active: true, createdAt: new Date(), updatedAt: new Date(), ...o,
});

function fakeDb(recs: RecurrenceDoc[], members = ["pag", "ana", "bia"], mailless: string[] = []) {
	const log = new Set<string>();
	const inserts: number[] = [];
	const finds: object[] = [];
	const expenseQueries: object[] = [];
	const cols: Record<string, unknown> = {
		recurrences: { find: (q: object) => (finds.push(q), { toArray: async () => recs }) },
		groups: { find: () => ({ toArray: async () => [{ _id: GID, name: "Casa", members: members.map(m) }] }) },
		expenses: { find: (q: object) => (expenseQueries.push(q), { toArray: async () => [] }) },
		users: { find: (q: { _id: { $in: string[] } }) => ({ toArray: async () => q._id.$in.map((id) => ({ _id: id, email: `${id}@x.test`, emailVerified: !mailless.includes(id) })) }) },
		push_subscriptions: { find: () => ({ toArray: async () => [] }) },
		reminder_log: {
			// Como o driver com `ordered: false`: insere o que pode e lança um erro só com os índices duplicados.
			insertMany: async (docs: { recurrenceId: string; period: string; lead: number; uid: string }[]) => {
				inserts.push(docs.length);
				const writeErrors: { index: number; code: number }[] = [];
				docs.forEach((d, index) => {
					const k = `${d.recurrenceId}|${d.period}|${d.lead}|${d.uid}`;
					if (log.has(k)) writeErrors.push({ index, code: 11000 });
					else log.add(k);
				});
				if (writeErrors.length) throw Object.assign(new Error("bulk"), { writeErrors });
			},
		},
	};
	return { db: { collection: (n: string) => cols[n] } as unknown as Db, log, finds, inserts, expenseQueries };
}
const NOW = new Date("2026-11-13T13:00:00Z"); // 10h em São Paulo, dia 13: 7 dias antes do dia 20
const SAVED = { ...process.env };
beforeEach(() => {
	Object.assign(process.env, { MAILGUN_SENDING_KEY: "k", MAILGUN_DOMAIN: "mg.x.test", EMAIL_FROM: "A <a@mg.x.test>" });
	notifyMock.mockClear();
});
afterEach(() => {
	process.env = { ...SAVED };
});

describe("runReminders", () => {
	it("envia uma vez; segunda execução (repetida ou simultânea) não duplica", async () => {
		const { db, log } = fakeDb([rec(1)]);
		const first = await runReminders(db, NOW);
		expect(first).toMatchObject({ planned: 2, sent: 2, failed: 0, duplicates: 0 });
		expect(notifyMock).toHaveBeenCalledTimes(1);
		expect(notifyMock.mock.calls[0][1].map((n) => [n.uid, n.title, n.url])).toEqual([["ana", "Lembrete de vencimento", `/app/grupos/${GID.toHexString()}`], ["bia", "Lembrete de vencimento", `/app/grupos/${GID.toHexString()}`]]);
		expect(log.size).toBe(2);
		notifyMock.mockClear();
		const second = await runReminders(db, NOW);
		expect(second).toMatchObject({ planned: 2, sent: 0, failed: 0, duplicates: 2 });
		expect(notifyMock.mock.calls.flatMap((c) => c[1])).toEqual([]);
		// duas execuções ao mesmo tempo, banco novo: cada lembrete sai uma vez só
		notifyMock.mockClear();
		const f = fakeDb([rec(1)]);
		await Promise.all([runReminders(f.db, NOW), runReminders(f.db, NOW)]);
		expect(notifyMock.mock.calls.flatMap((c) => c[1])).toHaveLength(2);
	});
	it("outro dia: nada (só 15, 7, 3 e 0)", async () => {
		const { db } = fakeDb([rec(1)]);
		expect(await runReminders(db, new Date("2026-11-14T13:00:00Z"))).toMatchObject({ planned: 0, sent: 0 });
		expect(notifyMock).not.toHaveBeenCalled();
	});
	it("o dia vem do fuso de São Paulo (01h UTC do dia 14 ainda é dia 13 lá)", async () => {
		const { db } = fakeDb([rec(1)]);
		expect((await runReminders(db, new Date("2026-11-14T01:30:00Z"))).planned).toBe(2);
	});
	it("sem canal de aviso configurado: nem consulta o banco", async () => {
		delete process.env.MAILGUN_SENDING_KEY;
		delete process.env.VAPID_PRIVATE_KEY;
		const { db, finds } = fakeDb([rec(1)]);
		expect(await runReminders(db, NOW)).toMatchObject({ channels: false, sent: 0 });
		expect(finds).toHaveLength(0);
	});
	it("teto por execução: processa só o máximo, em ordem estável, e conta o resto como adiado (com log só de números)", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const { db } = fakeDb(Array.from({ length: 40 }, (_, i) => rec(i + 1)));
		const r = await runReminders(db, NOW);
		expect(r.planned).toBe(80);
		expect(r.sent).toBe(MAX_REMINDERS_PER_RUN);
		expect(r.skipped).toBe(20);
		expect(log).toHaveBeenCalledWith("lembretes de vencimento: 0 falharam em todos os canais, 20 ficaram de fora pelo teto");
		log.mockRestore();
	});
	it("registro numa ida só por lote, e só do que vai ser tentado", async () => {
		const { db, inserts } = fakeDb(Array.from({ length: 12 }, (_, i) => rec(i + 1)));
		await runReminders(db, NOW);
		expect(inserts).toEqual([10, 10, 4]); // 24 lembretes planejados, em lotes de 10
	});
	it("falha em todos os canais: conta em `failed`, não reenvia e registra só números no log", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		notifyMock.mockImplementationOnce(async (_d, n) => ({ delivered: n.length - 1, failed: 1 }));
		const { db } = fakeDb([rec(1)]);
		const r = await runReminders(db, NOW);
		expect(r).toMatchObject({ sent: 1, failed: 1 });
		expect(log).toHaveBeenCalledWith("lembretes de vencimento: 1 falharam em todos os canais, 0 ficaram de fora pelo teto");
		expect(await runReminders(db, NOW)).toMatchObject({ sent: 0, duplicates: 2 }); // no máximo uma vez
		log.mockRestore();
	});
	it("com relógio simulado: nenhum envio começa sem folga e nenhum prazo passa do orçamento total", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-13T13:00:00Z"));
		const startedAt = Date.now();
		const calls: { at: number; deadline: number }[] = [];
		notifyMock.mockImplementation(async (_d, n, o) => {
			calls.push({ at: Date.now() - startedAt, deadline: (o?.deadline ?? 0) - startedAt });
			vi.advanceTimersByTime(12_000); // cada lote usa 12 s
			return { delivered: n.length, failed: 0 };
		});
		const { db, inserts } = fakeDb(Array.from({ length: 30 }, (_, i) => rec(i + 1)));
		const r = await runReminders(db, NOW);
		vi.useRealTimers();
		notifyMock.mockImplementation(async (_d, n) => ({ delivered: n.length, failed: 0 }));
		for (const c of calls) {
			expect(c.deadline).toBeLessThanOrEqual(RUN_BUDGET_MS);
			expect(c.deadline - c.at).toBeLessThanOrEqual(BATCH_BUDGET_MS);
			expect(c.deadline - c.at).toBeGreaterThanOrEqual(MIN_BATCH_START_MS);
		}
		expect(calls.map((c) => c.at)).toEqual([0, 12_000, 24_000, 36_000]); // o de 48 s nem começa
		expect(r.stoppedEarly).toBe(true);
		expect(inserts).toEqual([10, 10, 10, 10]); // só registrou o que tentou
		expect(r.sent + r.skipped).toBe(r.planned);
	});
	it("teto de tempo: sem folga para um lote, nada é registrado nem enviado", async () => {
		const { db, log } = fakeDb(Array.from({ length: 10 }, (_, i) => rec(i + 1)));
		const r = await runReminders(db, NOW, { budgetMs: 1_000 });
		expect(r).toMatchObject({ sent: 0, stoppedEarly: true });
		expect(log.size).toBe(0);
		expect(notifyMock).not.toHaveBeenCalled();
	});
	it("registra ANTES de enviar", async () => {
		const { db, log } = fakeDb([rec(1)]);
		notifyMock.mockImplementationOnce(async (_d, n) => {
			expect(log.size).toBe(2);
			return { delivered: n.length, failed: 0 };
		});
		await runReminders(db, NOW);
		expect(notifyMock).toHaveBeenCalled();
	});
	it("o resultado só tem contagens", async () => {
		const { db } = fakeDb([rec(1)]);
		const r = await runReminders(db, NOW);
		for (const v of Object.values(r)) expect(["number", "boolean"]).toContain(typeof v);
	});
});

describe("runReminders: canais e consulta", () => {
	it("quem não tem canal utilizável (e-mail não confirmado, sem push) não entra na fila nem gasta teto", async () => {
		const { db, log } = fakeDb([rec(1)], ["pag", "ana", "bia"], ["bia"]);
		const r = await runReminders(db, NOW);
		expect(r).toMatchObject({ planned: 1, sent: 1, noChannel: 1 });
		expect(log.size).toBe(1);
		expect(notifyMock.mock.calls[0][1].map((n) => n.uid)).toEqual(["ana"]);
	});
	it("com muita gente sem canal, o teto só conta quem pode receber", async () => {
		const many = Array.from({ length: 70 }, (_, i) => `u${i}`);
		const { db } = fakeDb([rec(1)], ["pag", ...many], many.slice(0, 40));
		const r = await runReminders(db, NOW);
		expect(r).toMatchObject({ noChannel: 40, planned: 30, sent: 30, skipped: 0 });
	});
	it("a consulta das despesas dos meses casa com o índice parcial (recurrence.id com $type string)", async () => {
		const { db, expenseQueries } = fakeDb([rec(1)]);
		await runReminders(db, NOW);
		expect(expenseQueries[0]).toMatchObject({ "recurrence.id": { $type: "string" }, "recurrence.period": { $in: ["2026-10", "2026-11", "2026-12"] } });
	});
});

describe("claimReminders", () => {
	const item = (uid: string) => ({ recurrenceId: "r", period: "2026-11", lead: 7, uid }) as never;
	it("erro que não é chave duplicada sobe (não finge que registrou)", async () => {
		const db = { collection: () => ({ insertMany: async () => Promise.reject(new Error("rede")) }) } as unknown as Db;
		await expect(claimReminders(db, [item("ana")], NOW)).rejects.toThrow("rede");
		const mixed = { collection: () => ({ insertMany: async () => Promise.reject(Object.assign(new Error("x"), { writeErrors: [{ index: 0, code: 11000 }, { index: 1, code: 121 }] })) }) } as unknown as Db;
		await expect(claimReminders(mixed, [item("a"), item("b")], NOW)).rejects.toThrow();
	});
	it("só devolve os que registrou; duplicados (11000) ficam de fora", async () => {
		const db = { collection: () => ({ insertMany: async () => Promise.reject(Object.assign(new Error("x"), { writeErrors: [{ index: 1, code: 11000 }] })) }) } as unknown as Db;
		expect((await claimReminders(db, [item("a"), item("b"), item("c")], NOW)).map((i) => i.uid)).toEqual(["a", "c"]);
	});
});
