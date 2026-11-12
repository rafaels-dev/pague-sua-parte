import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { buildRecurringExpense, materializeRecurrences, materializeSafely } from "./materialize";
import type { RecurrenceDoc } from "./collection";

const GID = new ObjectId("507f1f77bcf86cd799439011");
const m = (uid: string, extra: object = {}) => ({ uid, role: "member", joinedAt: new Date(), ...extra });
const group = (members = [m("u1"), m("u2"), m("u3")]) => ({ _id: GID, name: "G", members });
const rec = (over: Partial<RecurrenceDoc> = {}): RecurrenceDoc => ({
	_id: new ObjectId("607f1f77bcf86cd799439011"),
	groupId: GID,
	createdBy: "u1",
	paidBy: "u1",
	description: "Aluguel",
	amountCents: 3000,
	dayOfMonth: 31,
	participantMode: "all",
	participantUids: [],
	startPeriod: "2026-01",
	nextPeriod: "2026-01",
	active: true,
	createdAt: new Date(),
	updatedAt: new Date(),
	...over,
});

/** Banco de mentira só com o que a materialização usa; `updateOne` condicional como no MongoDB. */
function fakeDb(o: { recs: RecurrenceDoc[]; group?: unknown; pix?: boolean; insertError?: unknown }) {
	const recs = o.recs;
	const inserted: Record<string, unknown>[] = [];
	const recurrences = {
		find: vi.fn(() => ({ toArray: async () => recs.filter((r) => r.active && r.nextPeriod <= "2026-11").map((r) => ({ ...r })) })),
		updateOne: vi.fn(async (f: { _id: ObjectId; active?: boolean; nextPeriod?: string }, u: { $set: Partial<RecurrenceDoc> }) => {
			const r = recs.find((x) => x._id.equals(f._id));
			if (!r || (f.active !== undefined && r.active !== f.active) || (f.nextPeriod !== undefined && r.nextPeriod !== f.nextPeriod)) return { matchedCount: 0 };
			Object.assign(r, u.$set);
			return { matchedCount: 1 };
		}),
	};
	const expenses = {
		insertOne: vi.fn(async (d: Record<string, unknown>) => {
			if (o.insertError) throw o.insertError;
			inserted.push(d);
		}),
	};
	const groups = { find: vi.fn(() => ({ toArray: async () => ("group" in o ? [o.group] : [group()]) })) };
	const users = { findOne: vi.fn(async () => (o.pix === false ? { _id: "u1", name: "Ana" } : { _id: "u1", name: "Ana", displayName: "Aninha", pixKey: { type: "email", key: "a@x.com" } })) };
	const db = { collection: (n: string) => ({ recurrences, expenses, groups, users })[n] } as unknown as Db;
	return { db, recs, inserted, recurrences };
}
const NOW = new Date("2026-11-11T15:00:00Z");

describe("buildRecurringExpense", () => {
	it("despesa comum do mês: vencimento limitado, data no dia 1, cotas iguais, Pix atual, sem anexos", () => {
		const g = group() as never;
		const d = buildRecurringExpense(rec(), g, "2026-02", { type: "email", key: "a@x.com", payeeName: "Ana" }, NOW);
		expect(d).toMatchObject({
			paidBy: "u1",
			createdBy: "u1",
			date: "2026-02-01",
			dueDate: "2026-02-28",
			version: 0,
			attachments: [],
			recurrence: { id: "607f1f77bcf86cd799439011", period: "2026-02" },
			pix: { key: "a@x.com", payeeName: "Ana" },
		});
		expect(d.shares).toEqual([
			{ uid: "u1", amountCents: 1000, paidCents: 0 },
			{ uid: "u2", amountCents: 1000, paidCents: 0 },
			{ uid: "u3", amountCents: 1000, paidCents: 0 },
		]);
	});
	it("selecionados saídos do grupo são ignorados; sobrou ninguém = só quem paga", () => {
		const pix = { type: "email", key: "k", payeeName: "A" } as never;
		const g = group() as never;
		expect(buildRecurringExpense(rec({ participantMode: "selected", participantUids: ["u2", "gone"] }), g, "2026-03", pix, NOW).shares.map((s) => s.uid)).toEqual(["u2"]);
		expect(buildRecurringExpense(rec({ participantMode: "selected", participantUids: ["gone"] }), g, "2026-03", pix, NOW).shares).toEqual([{ uid: "u1", amountCents: 3000, paidCents: 0 }]);
		expect(buildRecurringExpense(rec({ participantMode: "alone" }), g, "2026-03", pix, NOW).shares).toHaveLength(1);
	});
	it("valor pequeno demais para o grupo: cobra só de quem paga", () => {
		const d = buildRecurringExpense(rec({ amountCents: 2 }), group() as never, "2026-03", { type: "email", key: "k", payeeName: "A" } as never, NOW);
		expect(d.shares).toEqual([{ uid: "u1", amountCents: 2, paidCents: 0 }]);
	});
});

describe("materializeRecurrences", () => {
	it("nada a fazer: só a consulta indexada", async () => {
		const { db, recurrences } = fakeDb({ recs: [rec({ nextPeriod: "2026-12" })] });
		expect(await materializeRecurrences(db, [GID], NOW)).toBe(0);
		expect(recurrences.find).toHaveBeenCalledOnce();
		expect(recurrences.find.mock.calls[0]).toEqual([{ groupId: { $in: [GID] }, active: true, nextPeriod: { $lte: "2026-11" } }]);
	});
	it("recupera os meses atrasados, um por vez, e avança o próximo mês", async () => {
		const { db, recs, inserted } = fakeDb({ recs: [rec({ nextPeriod: "2026-09" })] });
		expect(await materializeRecurrences(db, [GID], NOW)).toBe(3);
		expect(inserted.map((d) => (d.recurrence as { period: string }).period)).toEqual(["2026-09", "2026-10", "2026-11"]);
		expect(inserted.map((d) => d.dueDate)).toEqual(["2026-09-30", "2026-10-31", "2026-11-30"]);
		expect(recs[0]).toMatchObject({ nextPeriod: "2026-12", active: true });
		expect(await materializeRecurrences(db, [GID], NOW)).toBe(0);
		expect(inserted).toHaveLength(3);
	});
	it("no máximo 12 meses por chamada", async () => {
		const { db, recs } = fakeDb({ recs: [rec({ nextPeriod: "2025-01" })] });
		expect(await materializeRecurrences(db, [GID], NOW)).toBe(12);
		expect(recs[0].nextPeriod).toBe("2026-01");
	});
	it("endPeriod: gera até o fim e desativa", async () => {
		const { db, recs, inserted } = fakeDb({ recs: [rec({ nextPeriod: "2026-08", endPeriod: "2026-09" })] });
		expect(await materializeRecurrences(db, [GID], NOW)).toBe(2);
		expect(inserted).toHaveLength(2);
		expect(recs[0]).toMatchObject({ active: false, nextPeriod: "2026-10" });
		expect(recs[0].endedAt).toBeInstanceOf(Date);
	});
	it("fim já passado (editado): só desativa", async () => {
		const { db, recs, inserted } = fakeDb({ recs: [rec({ nextPeriod: "2026-10", endPeriod: "2026-09" })] });
		await materializeRecurrences(db, [GID], NOW);
		expect(inserted).toHaveLength(0);
		expect(recs[0].active).toBe(false);
	});
	it("quem paga saiu do grupo: desativa sem gerar", async () => {
		const { db, recs, inserted } = fakeDb({ recs: [rec({ paidBy: "gone" })] });
		await materializeRecurrences(db, [GID], NOW);
		expect(inserted).toHaveLength(0);
		expect(recs[0].active).toBe(false);
	});
	it("sem Pix agora: o mês é criado sem cópia da chave (vale a atual na leitura) e a recorrência avança", async () => {
		const { db, recs, inserted } = fakeDb({ recs: [rec({ nextPeriod: "2026-11" })], pix: false });
		expect(await materializeRecurrences(db, [GID], NOW)).toBe(1);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).not.toHaveProperty("pix");
		expect(inserted[0]).toMatchObject({ paidBy: "u1", recurrence: { period: "2026-11" } });
		expect(recs[0]).toMatchObject({ active: true, nextPeriod: "2026-12" });
	});
	it("reserva perdida (outra leitura já avançou): não insere nada", async () => {
		const f = fakeDb({ recs: [rec({ nextPeriod: "2026-11" })] });
		f.recurrences.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
		expect(await materializeRecurrences(f.db, [GID], NOW)).toBe(0);
		expect(f.inserted).toHaveLength(0);
	});
	it("chave duplicada é tolerada; outro erro devolve a reserva e é relançado", async () => {
		const dup = fakeDb({ recs: [rec({ nextPeriod: "2026-11" })], insertError: Object.assign(new Error("dup"), { code: 11000 }) });
		expect(await materializeRecurrences(dup.db, [GID], NOW)).toBe(0);
		expect(dup.recs[0].nextPeriod).toBe("2026-12");
		const bad = fakeDb({ recs: [rec({ nextPeriod: "2026-11" })], insertError: new Error("boom") });
		await expect(materializeRecurrences(bad.db, [GID], NOW)).rejects.toThrow("boom");
		expect(bad.recs[0]).toMatchObject({ nextPeriod: "2026-11", active: true });
	});
	it("materializeSafely nunca lança", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const bad = fakeDb({ recs: [rec({ nextPeriod: "2026-11" })], insertError: new Error("boom") });
		await expect(materializeSafely(bad.db, [GID], NOW)).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
