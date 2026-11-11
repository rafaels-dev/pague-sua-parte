import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { AttachmentStore } from "@/lib/storage/attachments";

const { createExpense, deleteExpense, getAttachmentRef, getExpenseDetail, getReceiptRef, getSummary, listExpenses, markSelfPaid, setSharePaid, updateParticipants } = await import("./repo");
const { listGroups } = await import("@/lib/groups/repo");

const GID = "507f1f77bcf86cd799439011";
const EID = "507f1f77bcf86cd799439022";
const AID = "a".repeat(32);
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const group = () => ({ _id: new ObjectId(GID), name: "G", members: [member("u1", "admin"), member("u2"), member("u3"), member("u4")] });
const PIX = { type: "email", key: "ana@x.com" };

type Share = { uid: string; amountCents: number; paidCents: number; paidAt?: Date; markedBy?: string; method?: "manual" | "self"; receipt?: { id: string; key: string; name: string; contentType: string; size: number } };
const S = (uid: string, amountCents: number, paidCents = 0, extra: Partial<Share> = {}): Share => ({ uid, amountCents, paidCents, ...extra });
const expense = (over: Record<string, unknown> = {}) => ({
	_id: new ObjectId(EID),
	groupId: new ObjectId(GID),
	createdBy: "u2",
	paidBy: "u2",
	description: "Mercado",
	amountCents: 3000,
	date: "2026-11-10",
	pix: { ...PIX, payeeName: "Beto" },
	shares: [S("u2", 1000), S("u1", 1000), S("u3", 1000)],
	version: 0,
	attachments: [{ id: AID, key: "groups/g/e/" + AID, name: "nota.pdf", contentType: "application/pdf", size: 10 }],
	createdAt: new Date("2026-11-10T10:00:00Z"),
	updatedAt: new Date(),
	...over,
});

function mockDb(o: { group?: unknown; payer?: unknown; expense?: unknown; expenses?: unknown[]; agg?: unknown[]; insertError?: Error; matched?: number } = {}) {
	const groups = {
		findOne: vi.fn().mockResolvedValue("group" in o ? o.group : group()),
		find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(GID), name: "G", members: [] }]) }),
	};
	const users = {
		findOne: vi.fn().mockResolvedValue("payer" in o ? o.payer : { _id: "u1", name: "Ana", pixKey: PIX }),
		find: vi.fn().mockReturnValue({
			toArray: vi.fn().mockResolvedValue([
				{ _id: "u1", name: "Ana", displayName: "Aninha", picture: "p1" },
				{ _id: "u2", name: "Beto" },
			]),
		}),
	};
	const cursor = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(o.expenses ?? []) };
	const expenses = {
		findOne: vi.fn().mockResolvedValue("expense" in o ? o.expense : expense()),
		find: vi.fn().mockReturnValue(cursor),
		insertOne: o.insertError ? vi.fn().mockRejectedValue(o.insertError) : vi.fn().mockResolvedValue({}),
		deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
		updateOne: vi.fn().mockResolvedValue({ matchedCount: o.matched ?? 1 }),
		// A listagem (tem $sort) devolve `expenses`; as agregações de saldo devolvem `agg`.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		aggregate: vi.fn((pipeline: any[]) => ({
			toArray: vi.fn().mockResolvedValue(pipeline.some((st) => "$sort" in st) ? (o.expenses ?? []) : (o.agg ?? [])),
		})),
		insertMany: vi.fn().mockResolvedValue({}),
		deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
	};
	const db = { collection: (n: string) => ({ groups, users, expenses })[n] } as unknown as Db;
	return { db, groups, users, expenses, cursor };
}

const fakeStore = () =>
	({
		put: vi.fn().mockResolvedValue(undefined),
		get: vi.fn(),
		delete: vi.fn().mockResolvedValue(undefined),
	}) satisfies AttachmentStore;

const input = { description: "Mercado", amountCents: 3000, date: "2026-11-10", participantUids: ["u1", "u2", "u3"] };
const pdf = { name: "nota.pdf", contentType: "application/pdf" as const, bytes: new Uint8Array([1, 2, 3]) };
const create = (db: Db, store: AttachmentStore, over: Partial<typeof input> = {}, files = [pdf], groupId = GID) =>
	createExpense(db, store, { groupId, uid: "u1", input: { ...input, ...over }, files });

beforeEach(() => vi.clearAllMocks());

describe("createExpense", () => {
	it("cria, divide e marca quem paga como payer", async () => {
		const { db, expenses } = mockDb();
		const store = fakeStore();
		const r = await create(db, store);
		expect(r.status).toBe("ok");
		const doc = expenses.insertOne.mock.calls[0][0];
		expect(doc).toMatchObject({ paidBy: "u1", createdBy: "u1", pix: { type: "email", key: "ana@x.com", payeeName: "Ana" } });
		expect(doc.shares).toEqual([
			{ uid: "u1", amountCents: 1000, paidCents: 0 },
			{ uid: "u2", amountCents: 1000, paidCents: 0 },
			{ uid: "u3", amountCents: 1000, paidCents: 0 },
		]);
		expect(doc.version).toBe(0);
		expect(doc.attachments).toHaveLength(1);
		expect(doc.attachments[0].key).toBe(`groups/${GID}/${doc._id.toHexString()}/${doc.attachments[0].id}`);
		expect(store.put).toHaveBeenCalledOnce();
	});
	it("quem paga fora da divisão não ganha cota", async () => {
		const { db, expenses } = mockDb();
		await create(db, fakeStore(), { participantUids: ["u2", "u3"] }, []);
		expect(expenses.insertOne.mock.calls[0][0].shares.map((s: Share) => s.uid)).toEqual(["u2", "u3"]);
	});
	it("não membro ou id malformado: no_group, sem tocar no storage", async () => {
		const store = fakeStore();
		expect((await create(mockDb({ group: null }).db, store)).status).toBe("no_group");
		expect((await create(mockDb().db, store, {}, [pdf], "malformado")).status).toBe("no_group");
		expect(store.put).not.toHaveBeenCalled();
	});
	it("sem chave Pix: no_pix, sem upload", async () => {
		const store = fakeStore();
		expect((await create(mockDb({ payer: { _id: "u1", name: "Ana" } }).db, store)).status).toBe("no_pix");
		expect((await create(mockDb({ payer: null }).db, store)).status).toBe("no_pix");
		expect(store.put).not.toHaveBeenCalled();
	});
	it("participante fora do grupo", async () => {
		const store = fakeStore();
		const r = await create(mockDb().db, store, { participantUids: ["u2", "intruso"] });
		expect(r).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(store.put).not.toHaveBeenCalled();
	});
	it("só o próprio usuário como participante é permitido", async () => {
		const { db, expenses } = mockDb();
		const r = await create(db, fakeStore(), { participantUids: ["u1"] }, []);
		expect(r.status).toBe("ok");
		expect(expenses.insertOne.mock.calls[0][0].shares).toEqual([{ uid: "u1", amountCents: 3000, paidCents: 0 }]);
		if (r.status === "ok") expect(r.expense).toMatchObject({ participantUids: ["u1"], canEditParticipants: true });
	});
	it("valor menor que o número de participantes", async () => {
		expect(await create(mockDb().db, fakeStore(), { amountCents: 2 })).toMatchObject({ status: "invalid", field: "amountCents" });
	});
	it("se o insert falha, apaga os objetos já enviados e propaga o erro", async () => {
		const { db } = mockDb({ insertError: new Error("db down") });
		const store = fakeStore();
		await expect(create(db, store, {}, [pdf, pdf])).rejects.toThrow("db down");
		expect(store.put).toHaveBeenCalledTimes(2);
		const uploaded = store.put.mock.calls.map((c) => c[0]);
		expect(store.delete).toHaveBeenCalledWith(uploaded);
	});
	it("se um upload falha no meio, apaga os anteriores", async () => {
		const { db } = mockDb();
		const store = fakeStore();
		store.put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("r2"));
		await expect(create(db, store, {}, [pdf, pdf])).rejects.toThrow("r2");
		expect(store.delete).toHaveBeenCalledWith([store.put.mock.calls[0][0]]);
	});
});

describe("listExpenses", () => {
	it("null para não membro", async () => {
		expect(await listExpenses(mockDb({ group: null }).db, GID, "x")).toBeNull();
	});
	it("yourStatus, due/refund, contagens; ordenação e limite", async () => {
		const noPart = expense({ _id: new ObjectId(), shares: [S("u2", 500), S("u3", 500)] });
		const mine = expense({ _id: new ObjectId(), paidBy: "u1", createdBy: "u1", shares: [S("u1", 1000), S("u2", 1000, 1000), S("u3", 1000)] });
		const refunds = expense({ _id: new ObjectId(), shares: [S("u2", 600), S("u1", 0, 400), S("u3", 600, 900)] });
		const partial = expense({ _id: new ObjectId(), shares: [S("u2", 600), S("u1", 600, 250)] });
		const m = mockDb({ expenses: [expense(), noPart, mine, refunds, partial] });
		const list = (await listExpenses(m.db, GID, "u1"))!;
		const pipeline = m.expenses.aggregate.mock.calls[0][0] as Record<string, unknown>[];
		expect(pipeline.find((st) => "$sort" in st)).toEqual({ $sort: { _rank: 1, _asc: 1, date: -1, createdAt: -1, _id: -1 } });
		expect(pipeline.find((st) => "$limit" in st)).toEqual({ $limit: 300 });
		expect(list[0]).toMatchObject({ yourStatus: "pending", yourShareCents: 1000, yourDueCents: 1000, yourRefundCents: 0, pendingCount: 2, refundCount: 0, attachmentCount: 1, paidBy: { uid: "u2", name: "Beto", isYou: false } });
		expect(list[1]).toMatchObject({ yourStatus: "none", yourShareCents: 0, yourDueCents: 0, yourRefundCents: 0, pendingCount: 1, refundCount: 0 });
		expect(list[2]).toMatchObject({ yourStatus: "payer", yourShareCents: 1000, yourDueCents: 0, pendingCount: 1, refundCount: 0, paidBy: { name: "Aninha", isYou: true } });
		expect(list[3]).toMatchObject({ yourStatus: "refund", yourShareCents: 0, yourDueCents: 0, yourRefundCents: 400, pendingCount: 0, refundCount: 2 });
		expect(list[4]).toMatchObject({ yourStatus: "pending", yourDueCents: 350, yourRefundCents: 0, pendingCount: 1 });
	});
});

describe("getExpenseDetail", () => {
	it("no_group / no_expense", async () => {
		expect((await getExpenseDetail(mockDb({ group: null }).db, GID, EID, "x")).status).toBe("no_group");
		expect((await getExpenseDetail(mockDb({ expense: null }).db, GID, EID, "u1")).status).toBe("no_expense");
		expect((await getExpenseDetail(mockDb().db, GID, "xx", "u1")).status).toBe("no_expense");
	});
	it("expõe Pix do pagador, esconde e-mail e chave R2; nomes com fallback", async () => {
		const r = await getExpenseDetail(mockDb().db, GID, EID, "u1");
		if (r.status !== "ok") throw new Error("esperava ok");
		const e = r.expense;
		expect(e.pix).toEqual({ type: "email", key: "ana@x.com", payeeName: "Beto" });
		expect(e.shares.map((s) => s.name)).toEqual(["Beto", "Aninha", "Participante"]);
		expect(e.shares[1]).toMatchObject({ isYou: true, picture: "p1" });
		expect(e.attachments).toEqual([{ id: AID, name: "nota.pdf", contentType: "application/pdf", size: 10 }]);
		const json = JSON.stringify(e);
		expect(json).not.toContain("groups/g/e");
		expect(json).not.toMatch(/"email"\s*:|"key"\s*:\s*"groups/);
		expect(e.canDelete).toBe(true); // u1 é admin
	});
	it("canDelete segue a regra de apagar", async () => {
		const get = async (uid: string, ex = expense()) => {
			const r = await getExpenseDetail(mockDb({ expense: ex }).db, GID, EID, uid);
			return r.status === "ok" && r.expense.canDelete;
		};
		expect(await get("u2")).toBe(true); // criador
		expect(await get("u3")).toBe(false); // outro membro
		expect(await get("u1", expense({ shares: [S("u2", 1), S("u1", 1, 1)] }))).toBe(false);
	});
});

describe("getAttachmentRef", () => {
	it("ok para membro", async () => {
		expect(await getAttachmentRef(mockDb().db, GID, EID, AID, "u1")).toEqual({ status: "ok", key: "groups/g/e/" + AID, name: "nota.pdf", contentType: "application/pdf" });
	});
	it("not_found: não membro, anexo inexistente, ids malformados", async () => {
		expect((await getAttachmentRef(mockDb({ group: null }).db, GID, EID, AID, "x")).status).toBe("not_found");
		expect((await getAttachmentRef(mockDb().db, GID, EID, "b".repeat(32), "u1")).status).toBe("not_found");
		expect((await getAttachmentRef(mockDb().db, GID, EID, "../x", "u1")).status).toBe("not_found");
		expect((await getAttachmentRef(mockDb({ expense: null }).db, GID, EID, AID, "u1")).status).toBe("not_found");
	});
});

describe("deleteExpense", () => {
	it("criador apaga e remove os anexos", async () => {
		const m = mockDb();
		const store = fakeStore();
		expect(await deleteExpense(m.db, store, GID, EID, "u2")).toEqual({ status: "ok", deleted: 1, kept: 0 });
		expect(m.expenses.deleteOne).toHaveBeenCalledWith(expect.objectContaining({ shares: { $not: { $elemMatch: { $or: [{ paidCents: { $gt: 0 } }, { status: "paid" }] } } } }));
		expect(store.delete).toHaveBeenCalledWith(["groups/g/e/" + AID]);
	});
	it("admin apaga despesa de outro", async () => {
		expect((await deleteExpense(mockDb().db, fakeStore(), GID, EID, "u1")).status).toBe("ok");
	});
	it("outro membro: forbidden", async () => {
		const m = mockDb();
		expect((await deleteExpense(m.db, fakeStore(), GID, EID, "u3")).status).toBe("forbidden");
		expect(m.expenses.deleteOne).not.toHaveBeenCalled();
	});
	it("com cota paga: has_payment, inclusive se a corrida for perdida", async () => {
		const paid = expense({ shares: [S("u2", 1), S("u1", 1, 1)] });
		const store = fakeStore();
		expect((await deleteExpense(mockDb({ expense: paid }).db, store, GID, EID, "u2")).status).toBe("has_payment");
		const race = mockDb();
		race.expenses.deleteOne.mockResolvedValue({ deletedCount: 0 });
		expect((await deleteExpense(race.db, store, GID, EID, "u2")).status).toBe("has_payment");
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("só reembolso pendente (cota 0 com pagamento) também bloqueia; cota do dono não conta", async () => {
		const refundOnly = expense({ shares: [S("u2", 1000), S("u3", 0, 400)] });
		expect((await deleteExpense(mockDb({ expense: refundOnly }).db, fakeStore(), GID, EID, "u2")).status).toBe("has_payment");
		const ownerPaidField = expense({ shares: [S("u2", 1000, 1000), S("u3", 1000)] });
		expect((await deleteExpense(mockDb({ expense: ownerPaidField }).db, fakeStore(), GID, EID, "u2")).status).toBe("ok");
	});
	it("não membro / inexistente", async () => {
		expect((await deleteExpense(mockDb({ group: null }).db, fakeStore(), GID, EID, "x")).status).toBe("no_group");
		expect((await deleteExpense(mockDb({ expense: null }).db, fakeStore(), GID, EID, "u1")).status).toBe("no_expense");
	});
});

describe("getSummary", () => {
	const G2 = new ObjectId("507f1f77bcf86cd799439033");
	it("zero sem grupos, sem consultar despesas", async () => {
		const m = mockDb();
		m.groups.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
		expect(await getSummary(m.db, "u1")).toEqual({ toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0, managed: [] });
		expect(m.expenses.aggregate).not.toHaveBeenCalled();
	});
	it("soma os saldos por grupo (uma agregação) e restringe aos grupos atuais", async () => {
		const m = mockDb({ agg: [{ _id: { g: new ObjectId(GID), u: "u1" }, toPay: 700, toReceive: 2500, toPayNow: 600, toReceiveNow: 2000, overdue: 100 }, { _id: { g: G2, u: "u1" }, toPay: 50, toReceive: 5, toPayNow: 40, toReceiveNow: 5, overdue: 10 }] });
		m.groups.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(GID), members: [] }, { _id: G2, members: [] }]) });
		expect(await getSummary(m.db, "u1")).toEqual({ toReceiveCents: 2505, toPayCents: 750, toReceiveNowCents: 2005, toPayNowCents: 640, overdueToPayCents: 110, managed: [] });
		expect(m.expenses.aggregate).toHaveBeenCalledTimes(1);
		const pipeline = m.expenses.aggregate.mock.calls[0][0];
		expect(pipeline[0].$match.groupId.$in).toHaveLength(2);
		expect(m.groups.find).toHaveBeenCalledWith({ "members.uid": "u1" }, expect.anything());
	});
	it("summary == soma dos grupos de GET /api/groups (mesma agregação)", async () => {
		const f = { toPayNow: 600, toReceiveNow: 2000, overdue: 100 };
		const g = { toPayNow: 40, toReceiveNow: 5, overdue: 10 };
		const rows = [{ _id: { g: new ObjectId(GID), u: "u1" }, toPay: 700, toReceive: 2500, ...f }, { _id: { g: G2, u: "u1" }, toPay: 50, toReceive: 5, ...g }];
		const gdocs = [
			{ _id: new ObjectId(GID), name: "A", members: [member("u1")], createdAt: new Date() },
			{ _id: G2, name: "B", members: [member("u1")], createdAt: new Date() },
		];
		const m = mockDb({ agg: [{ _id: new ObjectId(GID), toPay: 700, toReceive: 2500, ...f }, { _id: G2, toPay: 50, toReceive: 5, ...g }] });
		const sumM = mockDb({ agg: rows });
		sumM.groups.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue(gdocs) });
		m.groups.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue(gdocs), sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(gdocs) }) });
		const groups = await listGroups(m.db, "u1");
		const summary = await getSummary(sumM.db, "u1");
		for (const k of ["toReceiveCents", "toPayCents", "toReceiveNowCents", "toPayNowCents", "overdueToPayCents"] as const) {
			expect(summary[k]).toBe(groups.reduce((a, x) => a + x[k], 0));
		}
		expect(summary).toMatchObject({ toReceiveCents: 2505, toPayCents: 750, toReceiveNowCents: 2005, toPayNowCents: 640, overdueToPayCents: 110 });
	});
	it("o pipeline recebe o fim do mês e hoje (relógio injetado) e aplica 'agora'/'atrasado' só às dívidas", async () => {
		const m = mockDb();
		await getSummary(m.db, "u1", new Date("2026-02-10T12:00:00Z"));
		const text = JSON.stringify(m.expenses.aggregate.mock.calls[0][0]);
		expect(text).toContain('"2026-02-28"'); // fim do mês
		expect(text).toContain('"2026-02-10"'); // hoje
		expect(text).toContain("$dueDate");
	});
	it("o pipeline usa due/refund (max 0) e ignora a cota de quem pagou", async () => {
		const m = mockDb();
		await getSummary(m.db, "u1");
		const text = JSON.stringify(m.expenses.aggregate.mock.calls[0][0]);
		expect(text).toContain("$shares.paidCents");
		expect(text).toContain('"$max"');
		expect(text).toContain('"$ne":["$shares.uid","$paidBy"]');
	});
});

// ---------- fake com estado: simula findOne/updateOne com filtro de versão ----------

function statefulDb(initial: ReturnType<typeof expense>, opts: { failUpdates?: number; raceOnce?: boolean } = {}) {
	const clone = (d: ReturnType<typeof expense>) => ({ ...d, shares: d.shares.map((x) => ({ ...x })) }) as ReturnType<typeof expense>;
	let doc = clone(initial);
	let failures = opts.failUpdates ?? 0;
	const writes: unknown[] = [];
	const expenses = {
		findOne: vi.fn(async () => clone(doc)),
		updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown>; $inc?: { version: number } }) => {
			if (failures > 0) {
				failures--;
				return { matchedCount: 0 };
			}
			const v = filter.version as number | { $exists: boolean };
			const cur = (doc as { version?: number }).version;
			const ok = typeof v === "object" ? cur === undefined : cur === v;
			if (!ok) return { matchedCount: 0 };
			doc = { ...doc, ...update.$set, version: (cur ?? 0) + (update.$inc?.version ?? 0) } as typeof doc;
			writes.push(update);
			return { matchedCount: 1 };
		}),
	};
	const base = mockDb();
	const db = { collection: (n: string) => (n === "expenses" ? expenses : n === "groups" ? base.groups : base.users) } as unknown as Db;
	return { db, expenses, writes, get doc() { return doc; } };
}
const totalOf = (shares: { amountCents: number }[]) => shares.reduce((a, s) => a + s.amountCents, 0);

describe("setSharePaid", () => {
	const mark = (db: Db, target = "u1", status: "paid" | "pending" = "paid", uid = "u2", eid = EID, gid = GID) =>
		setSharePaid(db, gid, eid, uid, target, status);

	it("quita pendente: paidCents = amountCents, com paidAt/markedBy/method, e sobe a versão", async () => {
		const m = statefulDb(expense());
		const r = await mark(m.db);
		expect(r.status).toBe("ok");
		const u1 = m.doc.shares.find((s) => s.uid === "u1")!;
		expect(u1).toMatchObject({ paidCents: 1000, markedBy: "u2", method: "manual" });
		expect(u1.paidAt).toBeInstanceOf(Date);
		expect((m.doc as { version?: number }).version).toBe(1);
		expect(m.expenses.updateOne.mock.calls[0][0]).toMatchObject({ _id: new ObjectId(EID), groupId: new ObjectId(GID), paidBy: "u2", version: 0 });
		if (r.status === "ok") expect(r.expense.shares.find((s) => s.uid === "u1")).toMatchObject({ status: "paid", paidCents: 1000, dueCents: 0, refundCents: 0, method: "manual" });
	});
	it("desfazer volta a pending e remove paidAt, markedBy e method", async () => {
		const m = statefulDb(expense());
		await mark(m.db);
		const r = await mark(m.db, "u1", "pending");
		expect(r.status).toBe("ok");
		expect(m.doc.shares.find((s) => s.uid === "u1")).toEqual(S("u1", 1000, 0));
		expect((m.doc as { version?: number }).version).toBe(2);
	});
	it("idempotente: repetir não grava nem muda paidAt", async () => {
		const m = statefulDb(expense());
		await mark(m.db);
		const paidAt = m.doc.shares.find((s) => s.uid === "u1")!.paidAt;
		expect((await mark(m.db)).status).toBe("ok");
		expect(m.writes).toHaveLength(1);
		expect(m.doc.shares.find((s) => s.uid === "u1")!.paidAt).toEqual(paidAt);
		expect((await mark(m.db, "u3", "pending")).status).toBe("ok");
		expect(m.writes).toHaveLength(1);
	});
	it("devolve reembolso a quem saiu: a linha desaparece", async () => {
		const m = statefulDb(expense());
		await mark(m.db, "u3");
		await updateParticipants(m.db, GID, EID, "u2", ["u2", "u1"]);
		expect(m.doc.shares.find((s) => s.uid === "u3")).toMatchObject({ amountCents: 0, paidCents: 1000 });
		const r = await mark(m.db, "u3");
		expect(r.status).toBe("ok");
		expect(m.doc.shares.map((s) => s.uid)).toEqual(["u2", "u1"]);
		if (r.status === "ok") expect(r.expense.shares.map((s) => s.uid)).toEqual(["u2", "u1"]);
	});
	it("devolve reembolso de quem ainda participa: fica paid com paidCents = nova cota", async () => {
		const m = statefulDb(expense());
		await mark(m.db, "u1");
		await updateParticipants(m.db, GID, EID, "u2", ["u2", "u1", "u3", "u4"]);
		expect(m.doc.shares.find((s) => s.uid === "u1")).toMatchObject({ amountCents: 750, paidCents: 1000 });
		const r = await mark(m.db, "u1");
		if (r.status !== "ok") throw new Error("esperava ok");
		expect(r.expense.shares.find((s) => s.uid === "u1")).toMatchObject({ status: "paid", paidCents: 750, refundCents: 0 });
	});
	it("quem não pagou a despesa: forbidden, sem escrever", async () => {
		const m = statefulDb(expense());
		expect((await mark(m.db, "u3", "paid", "u1")).status).toBe("forbidden");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("não membro / grupo inválido: no_group, sem escrever", async () => {
		const m = mockDb({ group: null });
		expect((await mark(m.db, "u1", "paid", "x")).status).toBe("no_group");
		expect((await mark(mockDb().db, "u1", "paid", "u2", EID, "xx")).status).toBe("no_group");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("despesa inexistente ou id malformado: no_expense", async () => {
		expect((await mark(mockDb({ expense: null }).db)).status).toBe("no_expense");
		const m = mockDb();
		expect((await mark(m.db, "u1", "paid", "u2", "xx")).status).toBe("no_expense");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("quem não tem cota e a cota de quem pagou: no_share", async () => {
		expect((await mark(statefulDb(expense()).db, "u9")).status).toBe("no_share");
		expect((await mark(statefulDb(expense()).db, "u2")).status).toBe("no_share");
	});
	it("conflito de versão: tenta de novo uma vez; ok se a segunda passar, senão conflict", async () => {
		const once = statefulDb(expense(), { failUpdates: 1 });
		expect((await mark(once.db)).status).toBe("ok");
		expect(once.expenses.findOne).toHaveBeenCalledTimes(2);
		expect(once.expenses.updateOne).toHaveBeenCalledTimes(2);
		const twice = statefulDb(expense(), { failUpdates: 2 });
		expect(await mark(twice.db)).toEqual({ status: "conflict" });
		expect(twice.expenses.updateOne).toHaveBeenCalledTimes(2);
		expect(twice.doc.shares.find((s) => s.uid === "u1")!.paidCents).toBe(0);
	});
	it("despesa antiga sem version: filtra por $exists:false e passa a ter version 1", async () => {
		const legacy = expense();
		delete (legacy as { version?: number }).version;
		const m = statefulDb(legacy);
		expect((await mark(m.db)).status).toBe("ok");
		expect(m.expenses.updateOne.mock.calls[0][0].version).toEqual({ $exists: false });
		expect((m.doc as { version?: number }).version).toBe(1);
	});
});

describe("updateParticipants", () => {
	const upd = (db: Db, uids: string[], uid = "u2", eid = EID, gid = GID) => updateParticipants(db, gid, eid, uid, uids);
	const detail = async (r: Awaited<ReturnType<typeof upd>>) => {
		if (r.status !== "ok") throw new Error("esperava ok, veio " + r.status);
		return r.expense;
	};

	it("adiciona alguém depois que um participante pagou: surge reembolso e o total fecha", async () => {
		// grupo do mock: u1, u2, u3. u2 é dono. u3 paga 1000; entra u1... u1 já está; trocamos 3 -> 2 -> 3 abaixo.
		const m = statefulDb(expense({ shares: [S("u2", 1500), S("u1", 1500)], amountCents: 3000 }));
		await setSharePaid(m.db, GID, EID, "u2", "u1", "paid"); // u1 pagou 1500
		const d = await detail(await upd(m.db, ["u2", "u1", "u3"]));
		const u1 = d.shares.find((s) => s.uid === "u1")!;
		expect(u1).toMatchObject({ amountCents: 1000, paidCents: 1500, status: "refund", refundCents: 500, dueCents: 0, participates: true });
		expect(d.shares.find((s) => s.uid === "u3")).toMatchObject({ amountCents: 1000, status: "pending", dueCents: 1000 });
		expect(totalOf(m.doc.shares)).toBe(3000);
		expect(d.participantUids.sort()).toEqual(["u1", "u2", "u3"]);
		expect(d.canEditParticipants).toBe(true);
	});
	it("remove quem não pagou: a cota some", async () => {
		const m = statefulDb(expense());
		const d = await detail(await upd(m.db, ["u2", "u1"]));
		expect(d.shares.map((s) => s.uid)).toEqual(["u2", "u1"]);
		expect(totalOf(m.doc.shares)).toBe(3000);
		expect(m.doc.shares.map((s) => s.amountCents)).toEqual([1500, 1500]);
	});
	it("remove quem pagou: cota 0, reembolso integral, linha por último; adicionar de volta restaura", async () => {
		const m = statefulDb(expense());
		await setSharePaid(m.db, GID, EID, "u2", "u3", "paid");
		const d = await detail(await upd(m.db, ["u2", "u1"]));
		expect(d.shares.map((s) => s.uid)).toEqual(["u2", "u1", "u3"]);
		expect(d.shares[2]).toMatchObject({ amountCents: 0, paidCents: 1000, status: "refund", refundCents: 1000, participates: false });
		expect(d.participantUids).toEqual(["u2", "u1"]);
		expect(totalOf(m.doc.shares)).toBe(3000);
		const back = await detail(await upd(m.db, ["u2", "u1", "u3"]));
		expect(back.shares.find((s) => s.uid === "u3")).toMatchObject({ amountCents: 1000, paidCents: 1000, status: "paid" });
	});
	it("só o dono na lista: ele fica com o total", async () => {
		const m = statefulDb(expense());
		const d = await detail(await upd(m.db, ["u2"]));
		expect(d.shares.map((s) => [s.uid, s.amountCents, s.status])).toEqual([["u2", 3000, "payer"]]);
		expect(d.participantUids).toEqual(["u2"]);
	});
	it("dono fora da divisão: sem cota para ele, total fecha entre os outros", async () => {
		const m = statefulDb(expense());
		const d = await detail(await upd(m.db, ["u1", "u3"]));
		expect(d.shares.map((s) => s.uid)).toEqual(["u1", "u3"]);
		expect(totalOf(m.doc.shares)).toBe(3000);
	});
	it("grava com $inc de version e filtro pela versão lida", async () => {
		const m = statefulDb(expense());
		await upd(m.db, ["u2", "u1"]);
		expect(m.expenses.updateOne.mock.calls[0][0]).toMatchObject({ paidBy: "u2", version: 0 });
		expect(m.expenses.updateOne.mock.calls[0][1].$inc).toEqual({ version: 1 });
	});
	it("conflito de versão: repete uma vez; depois conflict, sem alterar nada", async () => {
		const once = statefulDb(expense(), { failUpdates: 1 });
		expect((await upd(once.db, ["u2", "u1"])).status).toBe("ok");
		const twice = statefulDb(expense(), { failUpdates: 2 });
		expect(await upd(twice.db, ["u2", "u1"])).toEqual({ status: "conflict" });
		expect(twice.doc.shares).toHaveLength(3);
	});
	it("duas edições concorrentes reais: a segunda relê a versão nova e não perde a primeira", async () => {
		const m = statefulDb(expense());
		// u2 edita; entre a leitura e a escrita a versão muda (simulado: uma escrita externa antes do 1º update)
		const original = m.expenses.updateOne.getMockImplementation()!;
		let injected = false;
		m.expenses.updateOne.mockImplementation(async (f, u) => {
			if (!injected) {
				injected = true;
				await original({ ...f }, { $set: { shares: [S("u2", 1000), S("u1", 1000, 1000, { paidAt: new Date(), markedBy: "u2", method: "manual" }), S("u3", 1000)] }, $inc: { version: 1 } });
			}
			return original(f, u);
		});
		const d = await detail(await upd(m.db, ["u2", "u1"]));
		expect(d.shares.find((s) => s.uid === "u1")).toMatchObject({ paidCents: 1500 - 500, amountCents: 1500, status: "pending", dueCents: 500 });
	});
	it("só o dono: forbidden, sem escrever", async () => {
		const m = statefulDb(expense());
		expect((await upd(m.db, ["u1"], "u1")).status).toBe("forbidden");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("participante fora do grupo, repetido ou vazio: invalid em participantUids", async () => {
		const m = statefulDb(expense());
		expect(await upd(m.db, ["u2", "intruso"])).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(await upd(m.db, ["u2", "u2"])).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(await upd(m.db, [])).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("valor menor que o número de participantes: invalid em amountCents", async () => {
		const m = statefulDb(expense({ amountCents: 2, shares: [S("u2", 1), S("u1", 1)] }));
		expect(await upd(m.db, ["u2", "u1", "u3"])).toMatchObject({ status: "invalid", field: "amountCents" });
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("não membro / despesa inexistente / id malformado", async () => {
		expect((await upd(mockDb({ group: null }).db, ["u2"])).status).toBe("no_group");
		expect((await upd(mockDb({ expense: null }).db, ["u2"])).status).toBe("no_expense");
		expect((await upd(mockDb().db, ["u2"], "u2", "xx")).status).toBe("no_expense");
	});
	it("sequência longa: totais sempre somam o valor e nenhuma cota 0 sem pagamento sobra", async () => {
		const m = statefulDb(expense({ amountCents: 1000, shares: [S("u2", 334), S("u1", 333), S("u3", 333)] }));
		const steps = [["u2"], ["u2", "u1"], ["u1", "u3"], ["u2", "u1", "u3"], ["u3"]];
		for (const [i, p] of steps.entries()) {
			if (i === 1) await setSharePaid(m.db, GID, EID, "u2", "u1", "paid");
			await upd(m.db, p);
			expect(totalOf(m.doc.shares)).toBe(1000);
			expect(m.doc.shares.some((s) => s.uid !== "u2" && s.amountCents === 0 && s.paidCents === 0)).toBe(false);
		}
	});
});

describe("detalhe: derivação e permissões", () => {
	const paidAt = new Date("2026-11-11T12:00:00Z");
	const mixed = () =>
		expense({
			shares: [S("u2", 1000), S("u1", 1000, 1000, { paidAt, markedBy: "u2", method: "manual" }), S("u3", 0, 300, { paidAt, markedBy: "u2", method: "manual" })],
		});
	const get = async (uid: string) => {
		const r = await getExpenseDetail(mockDb({ expense: mixed() }).db, GID, EID, uid);
		if (r.status !== "ok") throw new Error("esperava ok");
		return r.expense;
	};
	it("expõe campos derivados, paidAt e method; esconde markedBy", async () => {
		const owner = await get("u2");
		expect(owner.canMarkPaid).toBe(true);
		expect(owner.canEditParticipants).toBe(true);
		expect(owner.shares.map((s) => [s.uid, s.status, s.paidCents, s.dueCents, s.refundCents, s.participates])).toEqual([
			["u2", "payer", 0, 0, 0, true],
			["u1", "paid", 1000, 0, 0, true],
			["u3", "refund", 300, 0, 300, false],
		]);
		expect(owner.shares.map((s) => [s.paidAt, s.method])).toEqual([[null, null], [paidAt.toISOString(), "manual"], [paidAt.toISOString(), "manual"]]);
		expect(owner.shares.every((s) => !("markedBy" in s))).toBe(true);
		const other = await get("u1");
		expect(other.canMarkPaid).toBe(false);
		expect(other.canEditParticipants).toBe(false);
	});
	it("lista: parte paga ou reembolsada não conta como pendente; reembolso conta em refundCount", async () => {
		const list = await listExpenses(mockDb({ expenses: [mixed()] }).db, GID, "u2");
		expect(list?.[0]).toMatchObject({ pendingCount: 0, refundCount: 1 });
	});
});

// ---------- comprovantes ----------

const rcpt = (id: string) => ({ id, key: `receipts/g/e/${id}`, name: `${id}.png`, contentType: "image/png", size: 4 });
const PNG = { name: "pix.png", contentType: "image/png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
const paidAtR = new Date("2026-11-11T12:00:00Z");
const selfPaid = (r = rcpt("r1")) => S("u1", 1000, 1000, { paidAt: paidAtR, markedBy: "u1", method: "self", receipt: r });

describe("markSelfPaid", () => {
	const pay = (db: Db, store: AttachmentStore, o: { uid?: string; target?: string; file?: typeof PNG; eid?: string } = {}) =>
		markSelfPaid(db, store, { groupId: GID, eid: o.eid ?? EID, uid: o.uid ?? "u1", targetUid: o.target ?? "u1", file: o.file });

	it("cota pendente sem arquivo: quita como self, sem comprovante e sem tocar no armazenamento", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		const r = await pay(m.db, store);
		expect(r.status).toBe("ok");
		const u1 = m.doc.shares.find((s) => s.uid === "u1")!;
		expect(u1).toMatchObject({ paidCents: 1000, markedBy: "u1", method: "self" });
		expect(u1.receipt).toBeUndefined();
		expect(store.put).not.toHaveBeenCalled();
		if (r.status === "ok") expect(r.expense.shares.find((s) => s.uid === "u1")).toMatchObject({ status: "paid", method: "self", receipt: null, canPay: false, canAddReceipt: true });
	});
	it("com arquivo: grava em receipts/ e guarda os metadados na cota", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		const r = await pay(m.db, store, { file: PNG });
		const u1 = m.doc.shares.find((s) => s.uid === "u1")!;
		expect(u1.receipt).toMatchObject({ name: "pix.png", contentType: "image/png", size: 4 });
		expect(u1.receipt!.key.startsWith(`receipts/${GID}/${EID}/`)).toBe(true);
		expect(store.put).toHaveBeenCalledWith(u1.receipt!.key, PNG.bytes, "image/png");
		if (r.status === "ok") {
			const view = r.expense.shares.find((s) => s.uid === "u1")!;
			expect(view.receipt).toEqual({ name: "pix.png", contentType: "image/png", size: 4 });
			expect(JSON.stringify(r.expense)).not.toContain("receipts/");
		}
	});
	it("já quitada: com arquivo troca o comprovante, apaga o antigo e mantém paidAt/markedBy/method", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1000), selfPaid(), S("u3", 1000)] }));
		const store = fakeStore();
		expect((await pay(m.db, store, { file: PNG })).status).toBe("ok");
		const u1 = m.doc.shares.find((s) => s.uid === "u1")!;
		expect(u1).toMatchObject({ paidAt: paidAtR, markedBy: "u1", method: "self" });
		expect(u1.receipt!.id).not.toBe("r1");
		expect(store.delete).toHaveBeenCalledWith([rcpt("r1").key]);
	});
	it("já quitada sem arquivo: não grava nada", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1000), selfPaid(), S("u3", 1000)] }));
		const store = fakeStore();
		expect((await pay(m.db, store)).status).toBe("ok");
		expect(m.writes).toHaveLength(0);
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("403 se não age pela pessoa; 404 para dono, reembolso, sem cota, despesa e grupo", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		expect((await pay(m.db, store, { uid: "u3", target: "u1", file: PNG })).status).toBe("forbidden");
		expect((await pay(m.db, store, { uid: "u2", target: "u1" })).status).toBe("forbidden"); // o dono também não avisa por outro
		expect((await pay(m.db, store, { uid: "u2", target: "u2" })).status).toBe("no_share"); // a cota de quem pagou
		expect((await pay(m.db, store, { target: "u4" , uid: "u4" })).status).toBe("no_share");
		const refund = statefulDb(expense({ shares: [S("u2", 1500), S("u3", 1500), S("u1", 0, 500, { paidAt: paidAtR })] }));
		expect((await pay(refund.db, store, { file: PNG })).status).toBe("no_share");
		expect((await pay(mockDb({ expense: null }).db, store)).status).toBe("no_expense");
		expect((await pay(mockDb({ group: null }).db, store)).status).toBe("no_group");
		expect(store.put).not.toHaveBeenCalled();
		expect(m.writes).toHaveLength(0);
	});
	it("responsável paga por pessoa sem login", async () => {
		const BEN = "managed:ben";
		const g = { ...group(), members: [...group().members, { uid: BEN, role: "member", kind: "managed", managedBy: "u3", name: "Ben", joinedAt: new Date() }] };
		const base = statefulDb(expense({ shares: [S("u2", 1000), S(BEN, 1000), S("u3", 1000)] }));
		const db = { collection: (n: string) => (n === "groups" ? { findOne: vi.fn().mockResolvedValue(g) } : base.db.collection(n)) } as unknown as Db;
		const store = fakeStore();
		expect((await pay(db, store, { uid: "u1", target: BEN })).status).toBe("forbidden");
		expect((await pay(db, store, { uid: "u3", target: BEN, file: PNG })).status).toBe("ok");
		expect(base.doc.shares.find((s) => s.uid === BEN)).toMatchObject({ paidCents: 1000, markedBy: "u3", method: "self" });
	});
	it("falha na gravação (conflito): apaga o arquivo enviado", async () => {
		const m = statefulDb(expense(), { failUpdates: 5 });
		const store = fakeStore();
		expect((await pay(m.db, store, { file: PNG })).status).toBe("conflict");
		expect(store.put).toHaveBeenCalledTimes(1);
		expect(store.delete).toHaveBeenCalledWith([store.put.mock.calls[0][0]]);
	});
	it("erro do banco: apaga o arquivo e propaga", async () => {
		const m = statefulDb(expense());
		m.expenses.updateOne.mockRejectedValueOnce(new Error("boom"));
		const store = fakeStore();
		await expect(pay(m.db, store, { file: PNG })).rejects.toThrow("boom");
		expect(store.delete).toHaveBeenCalledWith([store.put.mock.calls[0][0]]);
	});
});

describe("comprovantes: desfazer, recalcular, apagar, detalhe", () => {
	it("dono desfaz: a cota perde o comprovante e o objeto é apagado; idempotente", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1000), selfPaid(), S("u3", 1000)] }));
		const store = fakeStore();
		expect((await setSharePaid(m.db, GID, EID, "u2", "u1", "pending", undefined, store)).status).toBe("ok");
		expect(m.doc.shares.find((s) => s.uid === "u1")).toEqual(S("u1", 1000, 0));
		expect(store.delete).toHaveBeenCalledWith([rcpt("r1").key]);
		await setSharePaid(m.db, GID, EID, "u2", "u1", "pending", undefined, store);
		expect(store.delete).toHaveBeenCalledTimes(1);
	});
	it("dono quita (paid) cota que já tem comprovante: mantém tudo", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1000), selfPaid(), S("u3", 1000)] }));
		const store = fakeStore();
		await setSharePaid(m.db, GID, EID, "u2", "u1", "paid", undefined, store);
		expect(m.doc.shares.find((s) => s.uid === "u1")).toMatchObject({ method: "self", receipt: rcpt("r1") });
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("recalcular: cota que fica (inclusive só reembolso) mantém comprovante e method", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1500), selfPaid(), S("u3", 500)] }));
		const store = fakeStore();
		await updateParticipants(m.db, GID, EID, "u2", ["u2", "u3"], "this", undefined, store);
		expect(m.doc.shares.find((s) => s.uid === "u1")).toMatchObject({ amountCents: 0, paidCents: 1000, method: "self", receipt: rcpt("r1") });
		await updateParticipants(m.db, GID, EID, "u2", ["u2", "u1", "u3"], "this", undefined, store);
		expect(m.doc.shares.find((s) => s.uid === "u1")).toMatchObject({ method: "self", receipt: rcpt("r1") });
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("devolver o reembolso remove a linha e o comprovante", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1500), S("u3", 1500), S("u1", 0, 1000, { method: "self", paidAt: paidAtR, receipt: rcpt("r1") })] }));
		const store = fakeStore();
		await setSharePaid(m.db, GID, EID, "u2", "u1", "paid", undefined, store);
		expect(m.doc.shares.some((s) => s.uid === "u1")).toBe(false);
		expect(store.delete).toHaveBeenCalledWith([rcpt("r1").key]);
	});
	it("deleteExpense apaga os comprovantes junto com os anexos", async () => {
		const m = mockDb({ expense: expense({ shares: [S("u2", 1000), S("u1", 1000), S("u3", 1000)] }) });
		const store = fakeStore();
		expect((await deleteExpense(m.db, store, GID, EID, "u2")).status).toBe("ok");
		// despesa sem pagamento não tem comprovante; com um comprovante legado a chave também sai
		const legacy = mockDb({ expense: expense({ shares: [S("u2", 1000), S("u1", 1000, 0, { receipt: rcpt("r9") })] }) });
		legacy.expenses.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
		expect((await deleteExpense(legacy.db, store, GID, EID, "u2")).status).toBe("ok");
		expect(store.delete).toHaveBeenCalledWith([rcpt("r9").key]);
	});
	it("detalhe: receipt só para quem pode baixar; canPay e canAddReceipt", async () => {
		const doc = () => expense({ shares: [S("u2", 1000), selfPaid(), S("u3", 1000), S("u4", 0, 300, { paidAt: paidAtR, receipt: rcpt("r4") })] });
		const get = async (uid: string) => {
			const r = await getExpenseDetail(mockDb({ expense: doc(), group: { ...group(), members: [...group().members] } }).db, GID, EID, uid);
			if (r.status !== "ok") throw new Error("esperava ok");
			return Object.fromEntries(r.expense.shares.map((s) => [s.uid, s]));
		};
		const [self, owner, other] = [await get("u1"), await get("u2"), await get("u3")];
		expect(self.u1).toMatchObject({ receipt: { name: "r1.png", contentType: "image/png", size: 4 }, canPay: false, canAddReceipt: true });
		expect(owner.u1.receipt).not.toBeNull();
		expect(owner.u1).toMatchObject({ canPay: false, canAddReceipt: false });
		expect(other.u1.receipt).toBeNull();
		expect(other.u3).toMatchObject({ canPay: true, canAddReceipt: false, receipt: null });
		expect(self.u3).toMatchObject({ canPay: false });
		expect(self.u2).toMatchObject({ canPay: false, canAddReceipt: false });
		expect(owner.u4.receipt).not.toBeNull(); // linha de reembolso: o dono vê
		expect(other.u4.receipt).toBeNull();
		for (const v of Object.values(self)) expect(v).not.toHaveProperty("key");
	});
	it("getReceiptRef: a pessoa e o dono baixam; os outros e a cota sem comprovante dão not_found", async () => {
		const open = (uid: string, target = "u1") => getReceiptRef(mockDb({ expense: expense({ shares: [S("u2", 1000), selfPaid(), S("u3", 1000)] }) }).db, GID, EID, target, uid);
		expect(await open("u1")).toEqual({ status: "ok", key: rcpt("r1").key, name: "r1.png", contentType: "image/png" });
		expect((await open("u2")).status).toBe("ok");
		expect((await open("u3")).status).toBe("not_found");
		expect((await open("u1", "u3")).status).toBe("not_found");
		expect((await getReceiptRef(mockDb({ group: null }).db, GID, EID, "u1", "x")).status).toBe("not_found");
	});
});
