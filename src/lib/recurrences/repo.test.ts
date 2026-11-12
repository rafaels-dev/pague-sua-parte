import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { RecurrenceDoc } from "./collection";

const { createRecurrence, endRecurrence, listRecurrences, updateRecurrence } = await import("./repo");

const GID = "507f1f77bcf86cd799439011";
const RID = "607f1f77bcf86cd799439011";
const NOW = new Date("2026-11-11T15:00:00Z");
const PIX = { type: "email", key: "a@x.com" };
const member = (uid: string, role = "member", extra: object = {}) => ({ uid, role, joinedAt: new Date(), ...extra });
const members = () => [member("u1", "admin"), member("u2"), member("m_vo", "member", { kind: "managed", name: "Vó", managedBy: "u2", pixKey: PIX })];
const rec = (over: Partial<RecurrenceDoc> = {}): RecurrenceDoc => ({
	_id: new ObjectId(RID),
	groupId: new ObjectId(GID),
	createdBy: "u2",
	paidBy: "u2",
	description: "Aluguel",
	amountCents: 3000,
	dayOfMonth: 25,
	participantMode: "all",
	participantUids: [],
	startPeriod: "2026-11",
	nextPeriod: "2026-11",
	active: true,
	createdAt: NOW,
	updatedAt: NOW,
	...over,
});

function mockDb(o: { members?: unknown[]; recs?: RecurrenceDoc[]; payerPix?: boolean; found?: RecurrenceDoc | null } = {}) {
	const groups = { findOne: vi.fn().mockResolvedValue("members" in o && !o.members ? null : { _id: new ObjectId(GID), name: "G", members: o.members ?? members() }) };
	const users = {
		findOne: vi.fn().mockResolvedValue(o.payerPix === false ? { _id: "u1" } : { _id: "u1", name: "Ana", pixKey: PIX }),
		find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: "u2", name: "Beto" }, { _id: "u1", name: "Ana" }]) }),
	};
	const recurrences = {
		find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(o.recs ?? []) })),
		findOne: vi.fn().mockResolvedValue("found" in o ? o.found : rec()),
		insertOne: vi.fn().mockResolvedValue({}),
		updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
		findOneAndUpdate: vi.fn(async (_f: unknown, u: { $set: object }) => ({ ...rec(), ...u.$set })),
	};
	const expenses = { findOne: vi.fn().mockResolvedValue(null) };
	const db = { collection: (n: string) => ({ groups, users, recurrences, expenses })[n] } as unknown as Db;
	return { db, recurrences, users };
}
const input = { description: "Aluguel", amountCents: 3000, dayOfMonth: 25, participantMode: "all" as const, participantUids: [], startPeriod: "2026-11" };

describe("listRecurrences", () => {
	it("ordena por dia e descrição, esconde quem saiu e marca canEdit", async () => {
		const { db } = mockDb({ recs: [rec({ _id: new ObjectId(), dayOfMonth: 30, description: "B" }), rec({ _id: new ObjectId(), description: "Z" }), rec({ _id: new ObjectId(), description: "A", paidBy: "gone" })] });
		const list = (await listRecurrences(db, GID, "u1"))!;
		expect(list.map((r) => r.description)).toEqual(["Z", "B"]);
		expect(list[0]).toMatchObject({ canEdit: true, nextDueDate: "2026-11-25", endPeriod: null, paidBy: { uid: "u2", name: "Beto", isYou: false, kind: "user", youManage: false } });
		expect((await listRecurrences(db, GID, "u3")) !== null).toBe(true);
	});
	it("canEdit: quem paga ou admin; membro comum não", async () => {
		const { db } = mockDb({ recs: [rec()], members: [member("u1"), member("u2"), member("u3")] });
		expect((await listRecurrences(db, GID, "u3"))![0].canEdit).toBe(false);
		expect((await listRecurrences(db, GID, "u2"))![0].canEdit).toBe(true);
	});
	it("null fora do grupo", async () => {
		expect(await listRecurrences(mockDb({ members: undefined }).db, GID, "u9")).toBeNull();
	});
});

describe("createRecurrence", () => {
	it("cria, tenta gerar o mês e devolve firstExpenseId", async () => {
		const { db, recurrences } = mockDb();
		const ex = (db.collection("expenses") as unknown as { findOne: ReturnType<typeof vi.fn> });
		ex.findOne.mockResolvedValue({ _id: new ObjectId("707f1f77bcf86cd799439011") });
		const r = await createRecurrence(db, { groupId: GID, uid: "u2", input, now: NOW });
		expect(r).toMatchObject({ status: "ok", firstExpenseId: "707f1f77bcf86cd799439011", recurrence: { description: "Aluguel", dayOfMonth: 25 } });
		expect(recurrences.insertOne.mock.calls[0][0]).toMatchObject({ paidBy: "u2", nextPeriod: "2026-11", active: true, participantUids: [] });
	});
	it("sem Pix: no_pix; pago por pessoa sem login exige quem cuida", async () => {
		expect(await createRecurrence(mockDb({ payerPix: false }).db, { groupId: GID, uid: "u1", input, now: NOW })).toEqual({ status: "no_pix" });
		expect(await createRecurrence(mockDb().db, { groupId: GID, uid: "u2", input: { ...input, paidByUid: "m_vo" }, now: NOW })).toMatchObject({ status: "ok" });
		expect(await createRecurrence(mockDb().db, { groupId: GID, uid: "u1", input: { ...input, paidByUid: "m_vo" }, now: NOW })).toMatchObject({ status: "ok" }); // u1 é administrador
		const plain = [member("u1"), member("u2"), member("u3"), member("m_vo", "member", { kind: "managed", name: "Vó", managedBy: "u2", pixKey: PIX })];
		expect(await createRecurrence(mockDb({ members: plain }).db, { groupId: GID, uid: "u3", input: { ...input, paidByUid: "m_vo" }, now: NOW })).toMatchObject({ status: "invalid", field: "paidByUid" });
		expect(await createRecurrence(mockDb({ members: plain }).db, { groupId: GID, uid: "u3", input: { ...input, paidByUid: "u2" }, now: NOW })).toMatchObject({ status: "invalid", field: "paidByUid" });
	});
	it("administrador cria por alguém sem chave Pix (cada mês usa a chave de quem paga na hora); comum com cuidada sem chave: no_pix", async () => {
		const { db, recurrences } = mockDb({ payerPix: false });
		expect(await createRecurrence(db, { groupId: GID, uid: "u1", input: { ...input, paidByUid: "u2" }, now: NOW })).toMatchObject({ status: "ok" });
		expect(recurrences.insertOne.mock.calls[0][0]).toMatchObject({ paidBy: "u2", createdBy: "u1" });
	});
	it("participantes fora do grupo e valor pequeno demais", async () => {
		const sel = { ...input, participantMode: "selected" as const, participantUids: ["x"] };
		expect(await createRecurrence(mockDb().db, { groupId: GID, uid: "u2", input: sel, now: NOW })).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(await createRecurrence(mockDb().db, { groupId: GID, uid: "u2", input: { ...input, amountCents: 2 }, now: NOW })).toMatchObject({ status: "invalid", field: "amountCents" });
	});
});

describe("updateRecurrence / endRecurrence", () => {
	it("só quem pode editar; atualiza campos", async () => {
		const m = mockDb({ members: [member("u1"), member("u2"), member("u3")] });
		expect(await updateRecurrence(m.db, { groupId: GID, rid: RID, uid: "u3", patch: { amountCents: 4000 } })).toEqual({ status: "forbidden" });
		const r = await updateRecurrence(m.db, { groupId: GID, rid: RID, uid: "u2", patch: { amountCents: 4000, endPeriod: "2027-01" }, now: NOW });
		expect(r).toMatchObject({ status: "ok", recurrence: { amountCents: 4000, endPeriod: "2027-01" } });
	});
	it("fim antes do próximo mês encerra; fim antes do início é inválido; remover fim usa $unset", async () => {
		const m = mockDb();
		await updateRecurrence(m.db, { groupId: GID, rid: RID, uid: "u2", patch: { endPeriod: "2026-11" }, now: NOW });
		expect((m.recurrences.findOneAndUpdate.mock.calls[0][1].$set as { active?: boolean }).active).toBeUndefined();
		const m2 = mockDb({ found: rec({ nextPeriod: "2026-12" }) });
		await updateRecurrence(m2.db, { groupId: GID, rid: RID, uid: "u2", patch: { endPeriod: "2026-11" }, now: NOW });
		expect(m2.recurrences.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ active: false });
		expect(await updateRecurrence(m.db, { groupId: GID, rid: RID, uid: "u2", patch: { endPeriod: "2026-10" } })).toMatchObject({ status: "invalid", field: "endPeriod" });
		await updateRecurrence(m.db, { groupId: GID, rid: RID, uid: "u2", patch: { endPeriod: null } });
		expect(m.recurrences.findOneAndUpdate.mock.calls.at(-1)![1]).toMatchObject({ $unset: { endPeriod: "" } });
	});
	it("selected sem escolhidos é inválido; id ruim ou inexistente = não encontrada", async () => {
		expect(await updateRecurrence(mockDb().db, { groupId: GID, rid: RID, uid: "u2", patch: { participantMode: "selected" } })).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(await updateRecurrence(mockDb().db, { groupId: GID, rid: "xx", uid: "u2", patch: { amountCents: 5 } })).toEqual({ status: "no_recurrence" });
		expect(await updateRecurrence(mockDb({ found: null }).db, { groupId: GID, rid: RID, uid: "u2", patch: { amountCents: 5 } })).toEqual({ status: "no_recurrence" });
	});
	it("encerrar: marca inativa, é idempotente e checa permissão", async () => {
		const m = mockDb();
		expect(await endRecurrence(m.db, { groupId: GID, rid: RID, uid: "u2", now: NOW })).toEqual({ status: "ok" });
		expect(m.recurrences.updateOne.mock.calls[0]).toEqual([{ _id: new ObjectId(RID), active: true }, { $set: { active: false, endedAt: NOW, updatedAt: NOW } }]);
		const inactive = mockDb({ found: rec({ active: false }) });
		expect(await endRecurrence(inactive.db, { groupId: GID, rid: RID, uid: "u2" })).toEqual({ status: "ok" });
		expect(await endRecurrence(mockDb({ members: [member("u2"), member("u3")] }).db, { groupId: GID, rid: RID, uid: "u3" })).toEqual({ status: "forbidden" });
		expect(await endRecurrence(mockDb({ found: null }).db, { groupId: GID, rid: RID, uid: "u2" })).toEqual({ status: "no_recurrence" });
	});
});
