import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { AttachmentStore } from "@/lib/storage/attachments";

const { getGroupSummary, createExpense, deleteExpense, editExpense, refundShare, getAttachmentRef, getExpenseDetail, getReceiptRef, getSummary, listExpenses, markSelfPaid, setSharePaid, updateParticipants } = await import("./repo");
const { listGroups } = await import("@/lib/groups/repo");

const GID = "507f1f77bcf86cd799439011";
const EID = "507f1f77bcf86cd799439022";
const AID = "a".repeat(32);
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const group = () => ({ _id: new ObjectId(GID), name: "G", members: [member("u1", "admin"), member("u2"), member("u3"), member("u4")] });
const PIX = { type: "email", key: "ana@x.com" };

type Share = { uid: string; amountCents: number; paidCents: number; parts?: { id: string; cents: number; at: Date; markedBy: string; method: "manual" | "self"; byAdmin?: boolean; receipt?: { id: string; key: string; name: string; contentType: string; size: number }; batch?: { id: string; totalCents: number; count: number } }[]; paidAt?: Date; markedBy?: string; markedByAdmin?: boolean; refund?: { cents: number; at: Date; markedBy: string; byAdmin?: boolean; receipt?: { id: string; key: string; name: string; contentType: string; size: number } }; method?: "manual" | "self"; receipt?: { id: string; key: string; name: string; contentType: string; size: number }; batch?: { id: string; totalCents: number; count: number } };
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
		expect(m.expenses.deleteOne).toHaveBeenCalledWith(expect.objectContaining({ shares: { $not: { $elemMatch: { $or: [{ paidCents: { $gt: 0 } }, { status: "paid" }, { refund: { $exists: true } }, { receipt: { $exists: true } }, { "parts.0": { $exists: true } }] } } } }));
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
		// Consulta de referências a comprovantes (`releaseReceipts`): devolve a despesa se alguma cota usa uma das chaves
		// (no pagamento que quitou, na devolução ou num pagamento parcial).
		find: vi.fn((filter: { $or?: Record<string, { $in?: string[] }>[] }) => ({
			toArray: async () => {
				const keys = new Set((filter.$or ?? []).flatMap((c) => Object.values(c).flatMap((v) => v.$in ?? [])));
				const used = doc.shares.flatMap((x) => [x.receipt?.key, x.refund?.receipt?.key, ...((x as { parts?: { receipt?: { key: string } }[] }).parts ?? []).map((p) => p.receipt?.key)]);
				return used.some((k) => k && keys.has(k)) ? [clone(doc)] : [];
			},
		})),
		updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown>; $unset?: Record<string, ""> ; $inc?: { version: number } }) => {
			if (failures > 0) {
				failures--;
				return { matchedCount: 0 };
			}
			const v = filter.version as number | { $exists: boolean };
			const cur = (doc as { version?: number }).version;
			const ok = typeof v === "object" ? cur === undefined : cur === v;
			if (!ok) return { matchedCount: 0 };
			doc = { ...doc, ...update.$set, version: (cur ?? 0) + (update.$inc?.version ?? 0) } as typeof doc;
			for (const k of Object.keys(update.$unset ?? {})) delete (doc as Record<string, unknown>)[k];
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
	it("devolve reembolso a quem saiu: a linha fica com a devolução registrada (cota 0, nada pago, Devolvido)", async () => {
		const m = statefulDb(expense());
		await mark(m.db, "u3");
		await updateParticipants(m.db, GID, EID, "u2", ["u2", "u1"]);
		expect(m.doc.shares.find((s) => s.uid === "u3")).toMatchObject({ amountCents: 0, paidCents: 1000 });
		const r = await mark(m.db, "u3");
		expect(r.status).toBe("ok");
		expect(m.doc.shares.find((s) => s.uid === "u3")).toMatchObject({ amountCents: 0, paidCents: 0, refund: { cents: 1000, markedBy: "u2" } });
		if (r.status === "ok") expect(r.expense.shares.find((s) => s.uid === "u3")).toMatchObject({ participates: false, status: "paid", refund: { cents: 1000 }, canUndoRefund: true });
		// desfazer a devolução: volta a ter 1000 a receber de volta
		await mark(m.db, "u3", "pending");
		expect(m.doc.shares.find((s) => s.uid === "u3")).toMatchObject({ amountCents: 0, paidCents: 1000 });
		expect(m.doc.shares.find((s) => s.uid === "u3")).not.toHaveProperty("refund");
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
		expect((await mark(m.db, "u3", "paid", "u4")).status).toBe("forbidden");
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
		expect((await upd(m.db, ["u1"], "u4")).status).toBe("forbidden");
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
		const other = await get("u4");
		expect(other.canMarkPaid).toBe(false);
		expect(other.canEditParticipants).toBe(false);
		expect(other.canEdit).toBe(false);
		expect(other.adminOnly).toBe(false);
		const admin = await get("u1"); // u1 administra o grupo, mas não pagou a despesa
		expect([admin.canMarkPaid, admin.canEditParticipants, admin.canEdit, admin.adminOnly]).toEqual([true, true, true, true]);
		expect(owner.adminOnly).toBe(false);
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
	it("despesa sem chave Pix resolvida: o devedor ainda pode avisar \"Já paguei\" (canPay) e o pagamento é registrado", async () => {
		const m = statefulDb(expense({ pix: undefined }));
		const before = await getExpenseDetail(m.db, GID, EID, "u1");
		if (before.status !== "ok") throw new Error("esperava ok");
		expect(before.expense.pix).toBeNull();
		expect(before.expense.shares.find((s) => s.uid === "u1")).toMatchObject({ status: "pending", canPay: true });
		const r = await pay(m.db, fakeStore());
		expect(r.status).toBe("ok");
		expect(m.doc.shares.find((s) => s.uid === "u1")).toMatchObject({ paidCents: 1000, method: "self" });
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
	it("comprovante de lote compartilhado: desfazer uma cota mantém o objeto enquanto outra cota o referencia", async () => {
		const batch = { id: "b", totalCents: 2000, count: 2 };
		const m = statefulDb(expense({ shares: [S("u2", 1000), S("u1", 1000, 1000, { method: "self", paidAt: paidAtR, receipt: rcpt("r1"), batch }), S("u3", 1000, 1000, { method: "self", paidAt: paidAtR, receipt: rcpt("r1"), batch })] }));
		const store = fakeStore();
		await setSharePaid(m.db, GID, EID, "u2", "u1", "pending", undefined, store);
		expect(m.doc.shares.find((s) => s.uid === "u1")).toEqual(S("u1", 1000, 0));
		expect(store.delete).not.toHaveBeenCalled();
		await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, store);
		expect(store.delete).toHaveBeenCalledWith([rcpt("r1").key]);
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
	it("devolver o reembolso mantém a linha e o comprovante do pagamento original", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1500), S("u3", 1500), S("u1", 0, 1000, { method: "self", paidAt: paidAtR, receipt: rcpt("r1") })] }));
		const store = fakeStore();
		await setSharePaid(m.db, GID, EID, "u2", "u1", "paid", undefined, store);
		expect(m.doc.shares.find((s) => s.uid === "u1")).toMatchObject({ amountCents: 0, paidCents: 0, receipt: rcpt("r1"), refund: { cents: 1000 } });
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("deleteExpense apaga os comprovantes junto com os anexos", async () => {
		const m = mockDb({ expense: expense({ shares: [S("u2", 1000), S("u1", 1000), S("u3", 1000)] }) });
		const store = fakeStore();
		expect((await deleteExpense(m.db, store, GID, EID, "u2")).status).toBe("ok");
		// cota com comprovante (mesmo sem valor pago) conta como histórico: não pode ser apagada, o comprovante fica
		const legacy = mockDb({ expense: expense({ shares: [S("u2", 1000), S("u1", 1000, 0, { receipt: rcpt("r9") })] }) });
		expect((await deleteExpense(legacy.db, store, GID, EID, "u2")).status).toBe("has_payment");
		expect(legacy.expenses.deleteOne).not.toHaveBeenCalled();
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
	it("detalhe: batch (lote) aparece só para quem vê o comprovante", async () => {
		const batch = { id: "b", totalCents: 2000, count: 2 };
		const doc = () => expense({ shares: [S("u2", 1000), S("u1", 1000, 1000, { method: "self", paidAt: paidAtR, receipt: rcpt("r1"), batch }), S("u3", 1000)] });
		const get = async (uid: string) => {
			const r = await getExpenseDetail(mockDb({ expense: doc() }).db, GID, EID, uid);
			if (r.status !== "ok") throw new Error("esperava ok");
			return Object.fromEntries(r.expense.shares.map((s) => [s.uid, s]));
		};
		expect((await get("u1")).u1.batch).toEqual({ totalCents: 2000, count: 2 });
		expect((await get("u2")).u1.batch).toEqual({ totalCents: 2000, count: 2 });
		expect((await get("u3")).u1.batch).toBeNull();
		expect((await get("u1")).u3.batch).toBeNull();
		expect(JSON.stringify(await get("u1"))).not.toContain('"id":"b"');
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

// ---------- poderes do administrador do grupo (u1 administra; u2 pagou; u3 e u4 são membros comuns) ----------

describe("administrador do grupo", () => {
	const store = () => fakeStore();
	const edit = (db: Db, uid: string, over: Partial<{ description: string; amountCents: number; date: string; participantUids: string[]; dueDate: string }> = {}) =>
		editExpense(db, store(), {
			groupId: GID,
			eid: EID,
			uid,
			input: { description: "Mercado", amountCents: 3000, date: "2026-11-10", participantUids: ["u2", "u1", "u3"], ...over },
		});
	const okOf = (r: { status: string }) => {
		if (r.status !== "ok") throw new Error("esperava ok, veio " + r.status);
		return (r as unknown as { expense: Awaited<ReturnType<typeof getExpenseDetail>> extends infer D ? (D extends { status: "ok"; expense: infer X } ? X : never) : never }).expense;
	};

	it("marca como pago qualquer cota de qualquer despesa, registra markedBy e markedByAdmin, e desfaz", async () => {
		const m = statefulDb(expense());
		const d = okOf(await setSharePaid(m.db, GID, EID, "u1", "u3", "paid"));
		expect(m.doc.shares.find((x) => x.uid === "u3")).toMatchObject({ paidCents: 1000, method: "manual", markedBy: "u1", markedByAdmin: true });
		expect(d.shares.find((x) => x.uid === "u3")).toMatchObject({ status: "paid", markedByAdmin: true, markedByName: "Aninha" });
		const undone = okOf(await setSharePaid(m.db, GID, EID, "u1", "u3", "pending"));
		expect(undone.shares.find((x) => x.uid === "u3")).toMatchObject({ status: "pending", markedByAdmin: false, markedByName: null });
		expect(m.doc.shares.find((x) => x.uid === "u3")).toEqual({ uid: "u3", amountCents: 1000, paidCents: 0 });
	});
	it("quando o dono marca, não vira marca de administrador (mesmo sendo admin e dono ao mesmo tempo)", async () => {
		const m = statefulDb(expense({ paidBy: "u1", createdBy: "u1", shares: [S("u1", 1000), S("u2", 1000), S("u3", 1000)] }));
		okOf(await setSharePaid(m.db, GID, EID, "u1", "u3", "paid"));
		expect(m.doc.shares.find((x) => x.uid === "u3")).not.toHaveProperty("markedByAdmin");
		const m2 = statefulDb(expense());
		okOf(await setSharePaid(m2.db, GID, EID, "u2", "u3", "paid"));
		expect(m2.doc.shares.find((x) => x.uid === "u3")).not.toHaveProperty("markedByAdmin");
	});
	it("membro comum continua sem poder marcar, mudar a divisão, editar ou ver o comprovante dos outros", async () => {
		const m = statefulDb(expense());
		expect((await setSharePaid(m.db, GID, EID, "u4", "u3", "paid")).status).toBe("forbidden");
		expect((await updateParticipants(m.db, GID, EID, "u4", ["u2"])).status).toBe("forbidden");
		expect((await edit(m.db, "u4", { description: "X" })).status).toBe("forbidden");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		const withReceipt = expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { receipt: { id: "r", key: "k/r", name: "r.png", contentType: "image/png", size: 1 }, method: "self" })] });
		expect((await getReceiptRef(mockDb({ expense: withReceipt }).db, GID, EID, "u3", "u4")).status).toBe("not_found");
		expect((await getReceiptRef(mockDb({ expense: withReceipt }).db, GID, EID, "u3", "u1")).status).toBe("ok");
		const seen = okOf(await getExpenseDetail(mockDb({ expense: withReceipt }).db, GID, EID, "u1"));
		expect(seen.shares.find((x) => x.uid === "u3")!.receipt).not.toBeNull();
		const hidden = okOf(await getExpenseDetail(mockDb({ expense: withReceipt }).db, GID, EID, "u4"));
		expect(hidden.shares.find((x) => x.uid === "u3")!.receipt).toBeNull();
	});
	it("não-membro do grupo não faz nada", async () => {
		expect((await edit(mockDb({ group: null }).db, "u1")).status).toBe("no_group");
	});
	it("pessoa sem login marcada como admin no cadastro não ganha poder de administrador", async () => {
		const g = { ...group(), members: [...group().members, { uid: "m_x", role: "admin" as const, kind: "managed" as const, managedBy: "u4", joinedAt: new Date() }] };
		const m = mockDb({ group: g });
		expect((await setSharePaid(m.db, GID, EID, "m_x", "u3", "paid")).status).toBe("forbidden");
	});

	it("editar: descrição, valor, data, vencimento e divisão, numa escrita só, com as cotas recalculadas", async () => {
		const m = statefulDb(expense());
		const d = okOf(await edit(m.db, "u1", { description: "Feira", amountCents: 4000, date: "2026-11-09", dueDate: "2026-12-10", participantUids: ["u2", "u1"] }));
		expect(m.expenses.updateOne).toHaveBeenCalledTimes(1);
		expect(d).toMatchObject({ description: "Feira", amountCents: 4000, date: "2026-11-09", dueDate: "2026-12-10", canEdit: true, adminOnly: true });
		expect(m.doc.shares.map((x) => [x.uid, x.amountCents])).toEqual([["u2", 2000], ["u1", 2000]]);
		expect((m.doc as { version: number }).version).toBe(1);
	});
	it("editar sem vencimento remove o vencimento (à vista)", async () => {
		const m = statefulDb(expense({ dueDate: "2026-12-10" }));
		okOf(await edit(m.db, "u2"));
		expect(m.doc).not.toHaveProperty("dueDate");
	});
	it("o dono também edita; parcela precisa continuar com vencimento", async () => {
		const m = statefulDb(expense({ installment: { seriesId: "s", number: 1, count: 3 }, dueDate: "2026-12-10" }));
		expect(await edit(m.db, "u2")).toMatchObject({ status: "invalid", field: "dueDate" });
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		okOf(await edit(statefulDb(expense()).db, "u2", { description: "Dono edita" }));
	});
	it("regra de cotas já pagas: o pago e o comprovante ficam; pagou a mais vira reembolso; quem saiu fica com cota 0", async () => {
		const rc = { id: "r", key: "k/r", name: "r.png", contentType: "image/png", size: 1 };
		const m = statefulDb(
			expense({ shares: [S("u2", 1000), S("u1", 1000, 1000, { receipt: rc, method: "self", markedBy: "u1" }), S("u3", 1000, 1000, { method: "manual", markedBy: "u2" })] }),
		);
		// valor cai para 1800 entre 3: 600 cada; u1 e u3 pagaram 1000 → reembolso de 400, nada se perde
		const d = okOf(await edit(m.db, "u1", { amountCents: 1800 }));
		expect(d.shares.find((x) => x.uid === "u1")).toMatchObject({ amountCents: 600, paidCents: 1000, status: "refund", refundCents: 400, receipt: { name: "r.png" } });
		// u3 sai da divisão: cota 0 com o pago como reembolso
		const d2 = okOf(await edit(m.db, "u1", { amountCents: 1800, participantUids: ["u2", "u1"] }));
		expect(d2.shares.find((x) => x.uid === "u3")).toMatchObject({ amountCents: 0, paidCents: 1000, status: "refund", refundCents: 1000, participates: false });
		expect(m.doc.shares.find((x) => x.uid === "u1")!.receipt).toEqual(rc);
	});
	it("valor sobe: quem estava pago passa a faltar a diferença", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1000), S("u1", 1000, 1000, { method: "manual", markedBy: "u2" }), S("u3", 1000)] }));
		const d = okOf(await edit(m.db, "u1", { amountCents: 4500 }));
		expect(d.shares.find((x) => x.uid === "u1")).toMatchObject({ amountCents: 1500, paidCents: 1000, status: "pending", dueCents: 500 });
	});
	it("inválidos: fora do grupo, vazio e pequeno demais, sem escrever", async () => {
		const m = statefulDb(expense());
		expect(await edit(m.db, "u1", { participantUids: ["u2", "intruso"] })).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(await edit(m.db, "u1", { participantUids: [] })).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(await edit(m.db, "u1", { amountCents: 2 })).toMatchObject({ status: "invalid", field: "amountCents" });
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("sem mudança nada é gravado; conflito de versão duas vezes vira conflict", async () => {
		const same = statefulDb(expense());
		okOf(await edit(same.db, "u1"));
		expect(same.expenses.updateOne).not.toHaveBeenCalled();
		const race = statefulDb(expense(), { failUpdates: 2 });
		expect(await edit(race.db, "u1", { description: "Outra" })).toEqual({ status: "conflict" });
	});
	it("apagar: admin pode (sem pagamento); membro comum não", async () => {
		const st = store();
		expect((await deleteExpense(mockDb().db, st, GID, EID, "u1")).status).toBe("ok");
		expect((await deleteExpense(mockDb().db, st, GID, EID, "u4")).status).toBe("forbidden");
	});
});

describe("devolução: Devolvi com comprovante, Pix de quem recebe e permissões", () => {
	const png = { name: "dev.png", contentType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
	// u2 pagou; u3 pagou 1500 por uma cota de 1000 (500 a receber de volta); u1 administra; u4 é só membro.
	const withRefund = () => expense({ shares: [S("u2", 1000), S("u1", 1000), S("u3", 1000, 1500, { method: "self", paidAt: new Date(), receipt: { id: "r", key: "k/pay", name: "pay.png", contentType: "image/png", size: 1 } })] });
	const call = (db: Db, store: ReturnType<typeof fakeStore>, uid: string, file?: typeof png) =>
		refundShare(db, store, { groupId: GID, eid: EID, uid, targetUid: "u3", file });

	it("o dono devolve com comprovante: grava o registro, guarda os DOIS comprovantes e não apaga nada", async () => {
		const m = statefulDb(withRefund());
		const store = fakeStore();
		const r = await call(m.db, store, "u2", png);
		expect(r.status).toBe("ok");
		const written = m.doc.shares.find((x) => x.uid === "u3") as unknown as { paidCents: number; receipt: { key: string }; refund: { cents: number; markedBy: string; receipt: { key: string } } };
		expect(written).toMatchObject({ paidCents: 1000, receipt: { key: "k/pay" }, refund: { cents: 500, markedBy: "u2" } });
		expect(written.refund.receipt.key).not.toBe("k/pay");
		expect(store.put).toHaveBeenCalledTimes(1);
		expect(store.delete).not.toHaveBeenCalled();
		if (r.status === "ok") expect(r.expense.shares.find((x) => x.uid === "u3")).toMatchObject({ status: "paid", refund: { cents: 500, byAdmin: false, receipt: { name: "dev.png" } }, canUndoRefund: true });
	});
	it("o administrador também devolve (byAdmin); membro comum é recusado sem subir nada", async () => {
		const m = statefulDb(withRefund());
		const store = fakeStore();
		expect((await call(m.db, store, "u1")).status).toBe("ok");
		expect(m.doc.shares.find((x) => x.uid === "u3")).toMatchObject({ refund: { markedBy: "u1", byAdmin: true } });
		const n = statefulDb(withRefund());
		const store2 = fakeStore();
		expect((await call(n.db, store2, "u4", png)).status).toBe("forbidden");
		expect(store2.put).not.toHaveBeenCalled();
		expect(n.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("sem devolução a fazer: no_share, sem subir nada", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		expect((await call(m.db, store, "u2", png)).status).toBe("no_share");
		expect(store.put).not.toHaveBeenCalled();
	});
	it("conflito de versão: o comprovante enviado é apagado", async () => {
		const m = statefulDb(withRefund(), { failUpdates: 2 });
		const store = fakeStore();
		expect((await call(m.db, store, "u2", png)).status).toBe("conflict");
		expect(store.delete).toHaveBeenCalledTimes(1);
	});
	it("desfazer a devolução (PATCH pending) apaga só o comprovante da devolução e volta ao 'a receber de volta'", async () => {
		const m = statefulDb(withRefund());
		const store = fakeStore();
		await call(m.db, store, "u2", png);
		const refundKey = (m.doc.shares.find((x) => x.uid === "u3") as unknown as { refund: { receipt: { key: string } } }).refund.receipt.key;
		await setSharePaid(m.db, GID, EID, "u1", "u3", "pending", undefined, store);
		expect(store.delete).toHaveBeenCalledWith([refundKey]);
		expect(m.doc.shares.find((x) => x.uid === "u3")).toMatchObject({ paidCents: 1500, receipt: { key: "k/pay" } });
	});
	it("detalhe: a chave Pix de quem recebe de volta vai só para quem paga a devolução (não para admin nem para os outros)", async () => {
		const get = async (uid: string) => {
			const r = await getExpenseDetail(mockDb({ expense: withRefund(), group: group() }).db, GID, EID, uid);
			if (r.status !== "ok") throw new Error("esperava ok");
			return r.expense.shares.find((x) => x.uid === "u3")!;
		};
		const owner = await get("u2");
		expect(owner).toMatchObject({ status: "refund", refundCents: 500, canRefund: true });
		expect(owner).toHaveProperty("refundPix"); // null se sem chave; o mock de usuários não traz pixKey
		for (const who of ["u1", "u4"]) expect(await get(who)).not.toHaveProperty("refundPix");
		expect((await get("u1")).canRefund).toBe(true);
		expect((await get("u4")).canRefund).toBe(false);
	});
	it("pessoa sem login que recebe de volta: usa a chave cadastrada no grupo", async () => {
		const g = { ...group(), members: [...group().members, { uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "u3", name: "Vovó", pixKey: { type: "email", key: "vo@x.com" }, joinedAt: new Date() }] };
		const doc = expense({ shares: [S("u2", 1000), S("m_vo", 1000, 1500)] });
		const r = await getExpenseDetail(mockDb({ expense: doc, group: g }).db, GID, EID, "u2");
		if (r.status !== "ok") throw new Error("esperava ok");
		expect(r.expense.shares.find((x) => x.uid === "m_vo")!.refundPix).toEqual({ type: "email", key: "vo@x.com", payeeName: "Vovó" });
	});
	it("comprovante da devolução: baixa quem recebeu, quem paga e o admin; os outros não", async () => {
		const doc = expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { refund: { cents: 500, at: new Date(), markedBy: "u2", receipt: { id: "d", key: "k/dev", name: "dev.png", contentType: "image/png", size: 1 } } })] });
		const open = (uid: string, kind: "payment" | "refund" = "refund") => getReceiptRef(mockDb({ expense: doc }).db, GID, EID, "u3", uid, kind);
		for (const who of ["u3", "u2", "u1"]) expect(await open(who)).toEqual({ status: "ok", key: "k/dev", name: "dev.png", contentType: "image/png" });
		expect((await open("u4")).status).toBe("not_found");
		expect((await open("u3", "payment")).status).toBe("not_found"); // o do pagamento é outro documento
	});
});

describe("revisão: corridas, vencimento antigo, resumo parcial e apagar com histórico", () => {
	const png = { name: "dev.png", contentType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
	it("refundShare: se a cota deixou de ter devolução entre a leitura e a gravação, NÃO a quita e apaga o comprovante enviado", async () => {
		const refundState = expense({ shares: [S("u2", 1000), S("u3", 1000, 1500)] });
		const pendingNow = expense({ shares: [S("u2", 1000), S("u3", 1000, 0)] });
		const m = mockDb({ expense: refundState });
		m.expenses.findOne.mockResolvedValueOnce(refundState).mockResolvedValue(pendingNow); // a segunda leitura (dentro da gravação) já é outra
		const store = fakeStore();
		const r = await refundShare(m.db, store, { groupId: GID, eid: EID, uid: "u2", targetUid: "u3", file: png });
		expect(r.status).toBe("no_share");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		expect(store.put).toHaveBeenCalledTimes(1);
		expect(store.delete).toHaveBeenCalledTimes(1); // o comprovante que subiu foi apagado
	});
	it("refundShare: cota já devolvida no meio do caminho é idempotente (nada gravado, comprovante apagado)", async () => {
		const refundState = expense({ shares: [S("u2", 1000), S("u3", 1000, 1500)] });
		const doneNow = expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { refund: { cents: 500, at: new Date(), markedBy: "u2" } })] });
		const m = mockDb({ expense: refundState });
		m.expenses.findOne.mockResolvedValueOnce(refundState).mockResolvedValue(doneNow);
		const store = fakeStore();
		expect((await refundShare(m.db, store, { groupId: GID, eid: EID, uid: "u2", targetUid: "u3", file: png })).status).toBe("ok");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		expect(store.delete).toHaveBeenCalledTimes(1);
	});
	it("editar só a descrição de uma despesa antiga com vencimento antes da data funciona; mexer nas datas mantendo o problema, não", async () => {
		const old = expense({ date: "2026-11-10", dueDate: "2026-11-01" });
		const input = { description: "Novo nome", amountCents: 3000, date: "2026-11-10", dueDate: "2026-11-01", participantUids: ["u2", "u1", "u3"] };
		const m = statefulDb(old);
		expect((await editExpense(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u1", input })).status).toBe("ok");
		expect(m.doc.description).toBe("Novo nome");
		const m2 = statefulDb(old);
		expect(await editExpense(m2.db, fakeStore(), { groupId: GID, eid: EID, uid: "u1", input: { ...input, dueDate: "2026-10-30" } })).toMatchObject({ status: "invalid", field: "dueDate" });
		expect(await editExpense(m2.db, fakeStore(), { groupId: GID, eid: EID, uid: "u1", input: { ...input, date: "2026-11-11" } })).toMatchObject({ status: "invalid", field: "dueDate" });
		expect(m2.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("resumo do grupo: passando do limite de despesas em aberto, devolve partial e usa só o limite", async () => {
		const docs = Array.from({ length: 5001 }, () => ({ paidBy: "u2", shares: [S("u2", 100), S("u3", 100)], dueDate: null }));
		const m = mockDb({ expenses: docs });
		const r = await getGroupSummary(m.db, GID, "u1");
		expect(r).toMatchObject({ partial: true, totalOpenCents: 5000 * 100 });
		const few = await getGroupSummary(mockDb({ expenses: docs.slice(0, 3) }).db, GID, "u1");
		expect(few).toMatchObject({ partial: false, totalOpenCents: 300 });
	});
	it("resumo do grupo: lista as despesas em aberto com o que falta, os próximos 15 dias e o mês da despesa fixa que ainda não existe; só nomes", async () => {
		const docs = [
			{ _id: new ObjectId(), paidBy: "u2", description: "Mercado", amountCents: 3000, date: "2026-11-01", dueDate: "2026-11-05", shares: [S("u2", 1000), S("u1", 1000), S("u3", 1000, 400)] },
			{ _id: new ObjectId(), paidBy: "u2", description: "Consulta", amountCents: 1500, date: "2026-11-10", dueDate: "2026-11-20", shares: [S("u2", 500), S("u1", 300, 500), S("u3", 700)] },
		];
		const m = mockDb({ expenses: docs });
		const base = (m.db as unknown as { collection: (n: string) => unknown }).collection;
		const rec = { _id: new ObjectId(), groupId: new ObjectId(GID), createdBy: "u1", paidBy: "u1", description: "Aluguel", amountCents: 4000, dayOfMonth: 5, participantMode: "all", participantUids: [], startPeriod: "2026-11", nextPeriod: "2026-12", active: true };
		const far = { ...rec, _id: new ObjectId(), description: "Muito longe", dayOfMonth: 28 };
		(m.db as unknown as { collection: (n: string) => unknown }).collection = (n: string) =>
			n === "recurrences" ? { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([rec, far]) }), updateOne: vi.fn(), insertOne: vi.fn() } : base(n);
		const r = (await getGroupSummary(m.db, GID, "u1", new Date("2026-11-12T15:00:00Z")))!;
		// atrasada primeiro; u3 pagou 400 de 1000: faltam 600
		expect(r.expenses.map((e) => [e.description, e.overdue, e.dueDate])).toEqual([["Mercado", true, "2026-11-05"], ["Consulta", false, "2026-11-20"]]);
		expect(r.expenses[0]).toMatchObject({ paidByName: "Beto", totalCents: 3000, owes: [{ name: "Aninha", cents: 1000 }, { name: "Participante", cents: 600 }] });
		expect(r.expenses[1]).toMatchObject({ owes: [{ name: "Participante", cents: 700 }], refunds: [{ name: "Aninha", cents: 200 }] });
		expect(r.upcoming.map((u) => u.description)).toEqual(["Consulta"]);
		expect(r.upcomingTotalCents).toBe(700);
		// o cabeçalho confere com o que as despesas mostram (sem compensação entre as duplas neste cenário)
		const shown = r.expenses.flatMap((e) => [...e.owes, ...e.refunds]).reduce((t, p) => t + p.cents, 0);
		expect(shown).toBe(r.totalOpenCents);
		expect(r.overdueCents).toBe(1600);
		// só nomes e valores: nada de chave Pix nem de códigos de usuário
		expect(JSON.stringify(r)).not.toMatch(/ana@x\.com|"u[0-9]"/);
		// despesa fixa cujo próximo mês cai nos próximos 15 dias entra, rotulada, mesmo sem existir ainda (e a distante não)
		const later = (await getGroupSummary(m.db, GID, "u1", new Date("2026-11-25T15:00:00Z")))!;
		expect(later.upcoming.map((u) => [u.dueDate, u.description, u.paidByName])).toEqual([["2026-12-05", "Aluguel (despesa fixa)", "Aninha"]]);
		expect(later.upcoming[0].owes.reduce((t, x) => t + x.cents, 0)).toBe(3000);
		expect(later.expenses.some((e) => e.description.startsWith("Aluguel"))).toBe(false);
	});
	it("resumo: mês projetado de despesa fixa cujo pagador não tem chave Pix também entra (o mês é criado sem cópia da chave, como o projetado)", async () => {
		const g = { ...group(), members: [...group().members, { uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "u1", name: "Vovó", joinedAt: new Date() }] };
		const m = mockDb({ group: g, expenses: [] });
		const base = (m.db as unknown as { collection: (n: string) => unknown }).collection;
		const rec = { _id: new ObjectId(), groupId: new ObjectId(GID), createdBy: "u1", paidBy: "m_vo", description: "Plano", amountCents: 4000, dayOfMonth: 5, participantMode: "all", participantUids: [], startPeriod: "2026-11", nextPeriod: "2026-12", active: true };
		(m.db as unknown as { collection: (n: string) => unknown }).collection = (n: string) =>
			n === "recurrences" ? { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([rec]) }), updateOne: vi.fn(), insertOne: vi.fn() } : base(n);
		const r = (await getGroupSummary(m.db, GID, "u1", new Date("2026-11-25T15:00:00Z")))!;
		expect(r.upcoming.map((u) => [u.description, u.paidByName])).toEqual([["Plano (despesa fixa)", "Vovó"]]);
		expect(r.upcoming[0].id).toBe(`modelo-${rec._id.toHexString()}`);
	});
	it("despesa sem cópia da chave: chave atual de formato inválido conta como ausente (pix null)", async () => {
		const doc = expense({ pix: undefined, paidBy: "u2", shares: [S("u2", 1000), S("u1", 1000)] });
		const bad = mockDb({ expense: doc });
		bad.users.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: "u2", name: "Beto", pixKey: { type: "zzz", key: "x" } }]) });
		const r = await getExpenseDetail(bad.db, GID, EID, "u1");
		if (r.status !== "ok") throw new Error("esperava ok");
		expect(r.expense.pix).toBeNull();
		const good = mockDb({ expense: doc });
		good.users.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: "u2", name: "Beto", pixKey: { type: "email", key: "b@x.com" } }]) });
		const g = await getExpenseDetail(good.db, GID, EID, "u1");
		if (g.status !== "ok") throw new Error("esperava ok");
		expect(g.expense.pix).toEqual({ type: "email", key: "b@x.com", payeeName: "Beto" });
	});
	it("apagar: despesa com cota 0 mas devolução registrada (ou comprovante) não pode ser apagada", async () => {
		const withRefund = expense({ shares: [S("u2", 1500), S("u1", 1500), S("u3", 0, 0, { refund: { cents: 1000, at: new Date(), markedBy: "u2" } })] });
		const m = mockDb({ expense: withRefund });
		expect((await deleteExpense(m.db, fakeStore(), GID, EID, "u2")).status).toBe("has_payment");
		expect(m.expenses.deleteOne).not.toHaveBeenCalled();
	});
	it("listagem: a cota 0 já devolvida de quem você cuida não aparece em 'managed'", async () => {
		const g = { ...group(), members: [...group().members, { uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "u1", name: "Vovó", joinedAt: new Date() }] };
		const doc = expense({ shares: [S("u2", 1500), S("u3", 1500), S("m_vo", 0, 0, { refund: { cents: 1000, at: new Date(), markedBy: "u2" } })] });
		const items = await listExpenses(mockDb({ group: g, expenses: [doc] }).db, GID, "u1");
		expect(items![0].managed).toEqual([]);
		expect(items![0].pendingCount).toBe(1); // só o u3; a Vovó (cota 0) não é participante
	});
	it("quem pagou a mais e saiu do grupo não tem a chave Pix servida (detalhe), mesmo com chave cadastrada", async () => {
		const g = { ...group(), members: group().members.filter((m) => m.uid !== "u3") }; // u3 saiu
		const doc = expense({ shares: [S("u2", 1000), S("u3", 1000, 1500)] });
		const r = await getExpenseDetail(mockDb({ expense: doc, group: g }).db, GID, EID, "u2");
		if (r.status !== "ok") throw new Error("esperava ok");
		expect(r.expense.shares.find((x) => x.uid === "u3")).toMatchObject({ status: "refund", refundPix: null, canRefund: true });
	});
	it("C: segundo toque em 'Devolvi' é sucesso sem gravar nem subir outro comprovante", async () => {
		const done = expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { refund: { cents: 500, at: new Date(), markedBy: "u2" } })] });
		const m = statefulDb(done);
		const store = fakeStore();
		const r = await refundShare(m.db, store, { groupId: GID, eid: EID, uid: "u2", targetUid: "u3", file: png });
		expect(r.status).toBe("ok");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		expect(store.put).not.toHaveBeenCalled();
		// parte comum paga em dia (sem devolução registrada) continua sendo no_share
		const plain = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { method: "manual", markedBy: "u2", paidAt: new Date() })] }));
		expect((await refundShare(plain.db, fakeStore(), { groupId: GID, eid: EID, uid: "u2", targetUid: "u3" })).status).toBe("no_share");
	});
	it("D: editar com um participante que saiu do grupo funciona; só quem ENTRA precisa ser do grupo", async () => {
		const g = { ...group(), members: group().members.filter((m) => m.uid !== "u3") }; // u3 saiu, mas ainda divide
		const doc = expense();
		const mk = () => {
			const base = statefulDb(doc);
			(base.db as unknown as { collection: (n: string) => unknown }).collection = ((orig) => (n: string) => (n === "groups" ? { findOne: vi.fn().mockResolvedValue(g) } : orig(n)))((base.db as unknown as { collection: (n: string) => unknown }).collection);
			return base;
		};
		const input = { description: "Só renomeei", amountCents: 3000, date: "2026-11-10", participantUids: ["u2", "u1", "u3"] };
		const m = mk();
		expect((await editExpense(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u1", input })).status).toBe("ok");
		expect(m.doc.description).toBe("Só renomeei");
		expect(m.doc.shares.map((x) => x.uid)).toContain("u3");
		// quem NÃO dividia e não é do grupo continua barrado
		expect(await editExpense(mk().db, fakeStore(), { groupId: GID, eid: EID, uid: "u1", input: { ...input, participantUids: ["u2", "u1", "u3", "intruso"] } })).toMatchObject({ status: "invalid", field: "participantUids" });
	});
});

// ---------- pagamento parcial ----------

/** Quanto a tela mostraria como já pago na parte `uid` agora (lê o documento do banco de mentira). */
const paidNow = async (db: Db, uid: string) => ((await (db.collection("expenses") as unknown as { findOne: () => Promise<{ shares: Share[] }> }).findOne()).shares.find((x) => x.uid === uid)?.paidCents ?? 0);

describe("pagamento parcial de uma parte", () => {
	const png = (n = 1) => ({ name: `p${n}.png`, contentType: "image/png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, n]) });
	const partial = async (db: Db, store: AttachmentStore, amountCents: number | undefined, o: { uid?: string; target?: string; file?: ReturnType<typeof png>; expected?: number } = {}) =>
		markSelfPaid(db, store, { groupId: GID, eid: EID, uid: o.uid ?? "u3", targetUid: o.target ?? "u3", file: o.file, amountCents, expectedPaidCents: amountCents === undefined ? undefined : (o.expected ?? (await paidNow(db, o.target ?? "u3"))) });
	const u3 = (m: { doc: { shares: Share[] } }) => m.doc.shares.find((x) => x.uid === "u3")!;
	const detailOf = (r: Awaited<ReturnType<typeof markSelfPaid>>) => {
		if (r.status !== "ok") throw new Error("esperava ok, veio " + r.status);
		return r.expense.shares.find((x) => x.uid === "u3")!;
	};

	it("\"Já paguei\" com valor menor: a parte fica em aberto, com histórico, comprovante e sem campos de topo", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		const r = await partial(m.db, store, 400, { file: png() });
		expect(u3(m)).toMatchObject({ paidCents: 400, parts: [{ cents: 400, markedBy: "u3", method: "self", receipt: { name: "p1.png" } }] });
		for (const k of ["paidAt", "markedBy", "method", "receipt"] as const) expect(u3(m)).not.toHaveProperty(k);
		const view = detailOf(r);
		expect(view).toMatchObject({ status: "pending", paidCents: 400, dueCents: 600, canPay: true, canUndoOwnPart: true, receipt: null, paidAt: null });
		expect(view.parts).toEqual([expect.objectContaining({ cents: 400, method: "self", byAdmin: false, receipt: { name: "p1.png", contentType: "image/png", size: 4 } })]);
		expect(JSON.stringify(r)).not.toContain("receipts/");
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("sem amountCents o comportamento é o de sempre (quita o que falta) mesmo com parcial antes; os dois comprovantes ficam", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		await partial(m.db, store, 400, { file: png(1) });
		const done = await partial(m.db, store, undefined, { file: png(2) });
		expect(u3(m)).toMatchObject({ paidCents: 1000, method: "self", markedBy: "u3", receipt: { name: "p2.png" } });
		expect(u3(m).parts).toHaveLength(1);
		expect(store.delete).not.toHaveBeenCalled();
		expect(detailOf(done)).toMatchObject({ status: "paid", parts: [expect.objectContaining({ cents: 400 })] });
	});
	it("valor igual ao que falta quita; maior, zero, negativo ou decimal são recusados sem gravar nem deixar arquivo", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		expect((await partial(m.db, store, 1000)).status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 1000, method: "self" });
		const m2 = statefulDb(expense());
		const store2 = fakeStore();
		expect(await partial(m2.db, store2, 1001, { file: png() })).toEqual({ status: "too_much" });
		expect(await partial(m2.db, store2, 0, { file: png() })).toEqual({ status: "invalid_amount" });
		expect(await partial(m2.db, store2, -5)).toEqual({ status: "invalid_amount" });
		expect(await partial(m2.db, store2, 10.5)).toEqual({ status: "invalid_amount" });
		expect(m2.expenses.updateOne).not.toHaveBeenCalled();
		expect(store2.put).not.toHaveBeenCalled(); // a conferência acontece antes de subir o arquivo
	});
	it("expectedPaidCents divergente (toque duplo, resposta perdida, tela velha): 409 \"stale\", sem gravar e sem subir arquivo", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		expect((await partial(m.db, store, 400, { file: png(1) })).status).toBe("ok");
		// o mesmo pedido de novo (a tela ainda mostrava 0 como já pago)
		expect(await partial(m.db, store, 400, { file: png(2), expected: 0 })).toEqual({ status: "stale" });
		expect(await partial(m.db, store, 400, { expected: 399 })).toEqual({ status: "stale" });
		expect(u3(m).paidCents).toBe(400);
		expect(u3(m).parts).toHaveLength(1);
		expect(store.put).toHaveBeenCalledTimes(1); // só o do primeiro; o do segundo nem subiu
		// valor sem expectedPaidCents (cliente que não manda): recusado como inválido; sem amountCents segue como sempre
		expect(await markSelfPaid(m.db, store, { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", amountCents: 100 })).toEqual({ status: "invalid_amount" });
		expect((await markSelfPaid(m.db, store, { groupId: GID, eid: EID, uid: "u3", targetUid: "u3" })).status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 1000, method: "self" });
	});
	it("o valor é conferido contra o que falta NO MOMENTO da gravação: corrida que quitou no meio recusa e apaga o arquivo", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		// entre a conferência prévia e a gravação, a parte foi quitada por outro caminho
		const find = m.expenses.findOne;
		let calls = 0;
		m.expenses.findOne = vi.fn(async (...a: unknown[]) => {
			if (++calls === 3) (m.doc.shares.find((x) => x.uid === "u3") as Share).paidCents = 1000;
			return (find as (...x: unknown[]) => Promise<unknown>)(...a);
		}) as typeof m.expenses.findOne;
		const r = await partial(m.db, store, 400, { file: png() });
		expect(r.status).toBe("stale"); // a parte mudou (já paga) entre a conferência prévia e a gravação
		expect(store.delete).toHaveBeenCalledTimes(1);
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("quem não age pela pessoa continua forbidden; parte de quem pagou ou inexistente = no_share", async () => {
		const m = statefulDb(expense());
		expect((await partial(m.db, fakeStore(), 100, { uid: "u4", target: "u3" })).status).toBe("forbidden");
		expect((await partial(m.db, fakeStore(), 100, { uid: "u2", target: "u2" })).status).toBe("no_share");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("no máximo 20 parciais por parte (too_many_parts), mas quitar continua possível", async () => {
		const m = statefulDb(expense({ amountCents: 300000, shares: [S("u2", 100000), S("u3", 100000), S("u1", 100000)] }));
		for (let i = 0; i < 20; i++) expect((await partial(m.db, fakeStore(), 1)).status).toBe("ok");
		expect(await partial(m.db, fakeStore(), 1)).toEqual({ status: "too_many_parts" });
		expect((await partial(m.db, fakeStore(), undefined)).status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 100000, method: "self" });
	});
	it("pagamento parcial gera fato de aviso com o valor pago e o que falta; quitar depois avisa só o último pagamento", async () => {
		const m = statefulDb(expense());
		const r = await partial(m.db, fakeStore(), 400);
		if (r.status !== "ok") throw new Error();
		expect(r.payments).toEqual([expect.objectContaining({ kind: "payment", debtorUid: "u3", amountCents: 400, partial: { shareCents: 1000, remainingCents: 600 }, manual: false })]);
		const done = await partial(m.db, fakeStore(), undefined);
		if (done.status !== "ok") throw new Error();
		expect(done.payments).toEqual([expect.objectContaining({ amountCents: 600 })]);
		expect(done.payments![0]).not.toHaveProperty("partial");
	});
});

describe("recebi só uma parte (setSharePaid com amountCents)", () => {
	const recv = async (db: Db, uid: string, cents?: number, status: "paid" | "pending" = "paid", target = "u3", expected?: number) =>
		setSharePaid(db, GID, EID, uid, target, status, undefined, undefined, cents, cents === undefined && status === "paid" ? undefined : (expected ?? (await paidNow(db, target))));
	const u3 = (m: { doc: { shares: Share[] } }) => m.doc.shares.find((x) => x.uid === "u3")!;

	it("quem pagou a despesa e o administrador registram; o admin fica marcado; membro comum não", async () => {
		const m = statefulDb(expense());
		expect((await recv(m.db, "u2", 347)).status).toBe("ok");
		expect((await recv(m.db, "u1", 100)).status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 447, parts: [{ cents: 347, markedBy: "u2", method: "manual" }, { cents: 100, markedBy: "u1", method: "manual", byAdmin: true }] });
		expect(u3(m).parts![0]).not.toHaveProperty("byAdmin");
		expect(u3(m)).not.toHaveProperty("paidAt");
		expect(await recv(m.db, "u4", 100)).toEqual({ status: "forbidden" });
		expect(await recv(m.db, "u3", 100)).toEqual({ status: "forbidden" }); // o devedor não "recebe" da própria parte
	});
	it("detalhe do administrador mostra quem marcou o parcial (nome só quando foi administrador)", async () => {
		const m = statefulDb(expense());
		await recv(m.db, "u1", 100);
		const r = await recv(m.db, "u2", 50);
		if (r.status !== "ok") throw new Error();
		const parts = r.expense.shares.find((x) => x.uid === "u3")!.parts;
		expect(parts.map((p) => [p.cents, p.byAdmin, p.markedByName])).toEqual([[100, true, "Aninha"], [50, false, null]]);
	});
	it("valor maior que o que falta, zero e decimal são recusados; igual quita; sem valor é o de sempre", async () => {
		const m = statefulDb(expense());
		expect(await recv(m.db, "u2", 1001)).toEqual({ status: "too_much" });
		expect(await recv(m.db, "u2", 0)).toEqual({ status: "invalid_amount" });
		expect(await recv(m.db, "u2", 3.3)).toEqual({ status: "invalid_amount" });
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		await recv(m.db, "u2", 400);
		expect(await recv(m.db, "u2", 601)).toEqual({ status: "too_much" });
		await recv(m.db, "u2", 600);
		expect(u3(m)).toMatchObject({ paidCents: 1000, method: "manual", markedBy: "u2" });
		const m2 = statefulDb(expense());
		await recv(m2.db, "u2", 400);
		await recv(m2.db, "u2");
		expect(u3(m2)).toMatchObject({ paidCents: 1000, method: "manual" });
	});
	it("desfazer: dono tira só o último; a pessoa desfaz o parcial que ela mesma avisou, mas não o que outro registrou nem a quitação", async () => {
		const m = statefulDb(expense());
		await markSelfPaid(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", amountCents: 200, expectedPaidCents: 0 });
		await recv(m.db, "u2", 300);
		// o último parcial é do dono: u3 não pode desfazê-lo
		expect(await recv(m.db, "u3", undefined, "pending")).toEqual({ status: "forbidden" });
		expect((await recv(m.db, "u2", undefined, "pending")).status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 200, parts: [expect.objectContaining({ cents: 200, method: "self" })] });
		// agora o último é o dele: pode desfazer
		const r = await recv(m.db, "u3", undefined, "pending");
		expect(r.status).toBe("ok");
		expect(u3(m)).toEqual({ uid: "u3", amountCents: 1000, paidCents: 0 });
		// quitação feita por ele: não pode desfazer sozinho
		await markSelfPaid(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u3", targetUid: "u3" });
		expect(await recv(m.db, "u3", undefined, "pending")).toEqual({ status: "forbidden" });
		// outro membro sem relação: nunca
		await markSelfPaid(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u3", targetUid: "u3" });
		expect(await recv(m.db, "u4", undefined, "pending")).toEqual({ status: "forbidden" });
	});
	it("\"Recebi só uma parte\": expectedPaidCents divergente (dono com tela velha depois que a pessoa já pagou o mesmo Pix) é recusado", async () => {
		const m = statefulDb(expense());
		await markSelfPaid(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", amountCents: 400, expectedPaidCents: 0 });
		expect(await recv(m.db, "u2", 400, "paid", "u3", 0)).toEqual({ status: "stale" });
		expect(await setSharePaid(m.db, GID, EID, "u2", "u3", "paid", undefined, undefined, 400)).toEqual({ status: "invalid_amount" }); // sem expectedPaidCents
		expect(u3(m).paidCents).toBe(400);
		expect((await recv(m.db, "u2", 400, "paid", "u3", 400)).status).toBe("ok");
		expect(u3(m).paidCents).toBe(800);
	});
	it("o aviso de recebimento parcial é manual e diz o que falta", async () => {
		const m = statefulDb(expense());
		const r = await recv(m.db, "u1", 250);
		if (r.status !== "ok") throw new Error();
		expect(r.payments).toEqual([expect.objectContaining({ amountCents: 250, manual: true, actorUid: "u1", partial: { shareCents: 1000, remainingCents: 750 } })]);
	});
});

describe("comprovantes de parciais nunca se perdem nem sobram", () => {
	const rcp = (id: string) => ({ id, key: `receipts/${id}`, name: `${id}.png`, contentType: "image/png", size: 4 });
	const part = (id: string, cents: number, receipt?: ReturnType<typeof rcp>) => ({ id, cents, at: new Date("2026-11-01T10:00:00Z"), markedBy: "u3", method: "self" as const, ...(receipt ? { receipt } : {}) });
	const withParts = (extra: Partial<Share> = {}) =>
		expense({ shares: [S("u2", 1000), S("u3", 1000, 600, { parts: [part("a1", 200, rcp("ra")), part("b2", 400, rcp("rb"))], ...extra })] });

	it("desfazer o último parcial apaga só o comprovante dele", async () => {
		const m = statefulDb(withParts());
		const st = fakeStore();
		await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, st, undefined, await paidNow(m.db, "u3"));
		expect(st.delete).toHaveBeenCalledWith([rcp("rb").key]);
		expect(m.doc.shares.find((x) => x.uid === "u3")!.parts).toEqual([expect.objectContaining({ id: "a1" })]);
	});
	it("desfazer a quitação apaga só o comprovante dela; os dos parciais ficam", async () => {
		const m = statefulDb(withParts({ paidCents: 1000, paidAt: new Date(), markedBy: "u3", method: "self", receipt: rcp("rq") }));
		const st = fakeStore();
		await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, st, undefined, await paidNow(m.db, "u3"));
		expect(st.delete).toHaveBeenCalledWith([rcp("rq").key]);
		expect(m.doc.shares.find((x) => x.uid === "u3")!.parts).toHaveLength(2);
	});
	it("editar a divisão com parciais não solta nenhum comprovante, mesmo virando devolução", async () => {
		const m = statefulDb(withParts());
		const st = fakeStore();
		const r = await editExpense(m.db, st, { groupId: GID, eid: EID, uid: "u2", input: { description: "Mercado", amountCents: 800, date: "2026-11-10", participantUids: ["u2", "u3"] } });
		expect(r.status).toBe("ok");
		expect(st.delete).not.toHaveBeenCalled();
		const u3 = m.doc.shares.find((x) => x.uid === "u3")!;
		expect(u3).toMatchObject({ amountCents: 400, paidCents: 600 });
		expect(u3.parts).toHaveLength(2);
		// e a tela mostra quem pagou por último e o comprovante do último parcial mesmo sem campos de topo
		if (r.status === "ok") expect(r.expense.shares.find((x) => x.uid === "u3")).toMatchObject({ status: "refund", method: "self", paidAt: "2026-11-01T10:00:00.000Z", receipt: { name: "rb.png" } });
	});
	it("apagar a despesa é barrado enquanto houver parcial", async () => {
		const m = statefulDb(withParts());
		expect((await deleteExpense(m.db, fakeStore(), GID, EID, "u2")).status).toBe("has_payment");
	});
	it("baixar o comprovante de um parcial: membros que agem pela pessoa ou por quem pagou; outro membro, não; id certo", async () => {
		const m = statefulDb(withParts());
		const ref = (uid: string, pid: string) => getReceiptRef(m.db, GID, EID, "u3", uid, "payment", pid);
		expect(await ref("u3", "a1")).toMatchObject({ status: "ok", key: rcp("ra").key });
		expect(await ref("u2", "b2")).toMatchObject({ status: "ok", key: rcp("rb").key });
		expect(await ref("u1", "a1")).toMatchObject({ status: "ok" }); // administrador
		expect((await ref("u4", "a1")).status).toBe("not_found");
		expect((await ref("u3", "nao-existe")).status).toBe("not_found");
		expect((await ref("u3", "a1")).status === "ok" && JSON.stringify(await ref("u3", "a1"))).toBeTruthy();
		// quem não é do grupo
		expect((await getReceiptRef(m.db, GID, EID, "u3", "intruso", "payment", "a1")).status).toBe("not_found");
	});
	it("o comprovante de quem não pode vê-lo não aparece no detalhe (membro comum vê o histórico, sem arquivos)", async () => {
		const m = statefulDb(withParts());
		const d = await getExpenseDetail(m.db, GID, EID, "u4");
		if (d.status !== "ok") throw new Error();
		const view = d.expense.shares.find((x) => x.uid === "u3")!;
		expect(view.parts.map((p) => [p.cents, p.receipt])).toEqual([[200, null], [400, null]]);
	});
	it("outra despesa (lote) que referencia o mesmo arquivo de um parcial: ao desfazer, o objeto fica", async () => {
		const m = statefulDb(withParts());
		// uma segunda cota da mesma despesa usa o arquivo "rb" (como um lote de "Pagar tudo")
		m.doc.shares.push(S("u1", 1000, 1000, { receipt: rcp("rb"), method: "self", markedBy: "u3", paidAt: new Date() }) as never);
		const st = fakeStore();
		await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, st, undefined, await paidNow(m.db, "u3"));
		expect(st.delete).not.toHaveBeenCalled();
	});
});

describe("pagamentos concorrentes, último pagamento e comprovante de parcial de outra parte/despesa", () => {
	const png = (n: number) => ({ name: `p${n}.png`, contentType: "image/png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, n]) });
	const rcp = (id: string) => ({ id, key: `receipts/${id}`, name: `${id}.png`, contentType: "image/png", size: 4 });
	const part = (id: string, cents: number, at: string, receipt?: ReturnType<typeof rcp>, markedBy = "u3", method: "self" | "manual" = "self") => ({ id, cents, at: new Date(at), markedBy, method, ...(receipt ? { receipt } : {}) });

	it("dois pagamentos concorrentes contra a mesma version: um ganha, o outro leva conflito (stale) e não deixa arquivo", async () => {
		const m = statefulDb(expense());
		const store = fakeStore();
		const call = (file: ReturnType<typeof png>) => markSelfPaid(m.db, store, { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", file, amountCents: 400, expectedPaidCents: 0 });
		const [x, y] = await Promise.all([call(png(1)), call(png(2))]);
		expect([x.status, y.status].sort()).toEqual(["ok", "stale"]);
		const doc = m.doc.shares.find((s) => s.uid === "u3")!;
		expect(doc.paidCents).toBe(400);
		expect(doc.parts).toHaveLength(1);
		expect(store.put).toHaveBeenCalledTimes(2); // os dois subiram (a conferência prévia passou nos dois)
		expect(store.delete).toHaveBeenCalledTimes(1); // o do perdedor foi apagado
		const kept = doc.parts![0].receipt!.key;
		expect(store.delete.mock.calls[0][0]).not.toContain(kept);
	});
	it("conflito de versão que esgota as tentativas (sem amountCents também): arquivo apagado", async () => {
		const m = statefulDb(expense(), { failUpdates: 2 });
		const store = fakeStore();
		expect((await markSelfPaid(m.db, store, { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", file: png(1), amountCents: 400, expectedPaidCents: 0 })).status).toBe("conflict");
		expect(store.delete).toHaveBeenCalledTimes(1);
	});
	it("devedor e dono marcando o mesmo Pix com telas desatualizadas: só o primeiro vale", async () => {
		const m = statefulDb(expense());
		expect((await markSelfPaid(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", amountCents: 400, expectedPaidCents: 0 })).status).toBe("ok");
		expect(await setSharePaid(m.db, GID, EID, "u2", "u3", "paid", undefined, undefined, 400, 0)).toEqual({ status: "stale" });
		expect(m.doc.shares.find((s) => s.uid === "u3")!.paidCents).toBe(400);
	});

	// parte de 100 com parcial de 20 e quitada com 80 (topo); a despesa subiu e a parte voltou a pendente com campos de topo
	const grown = () =>
		expense({ shares: [S("u2", 1500), S("u3", 1500, 1000, { parts: [part("p1", 200, "2026-11-01T10:00:00Z", rcp("r20"))], paidAt: new Date("2026-11-05T10:00:00Z"), markedBy: "u3", method: "self", receipt: rcp("r80") })] });
	it("B: a tela anuncia o pagamento que o servidor desfaz (o de R$ 80,00 e o comprovante dele), e o de R$ 20,00 fica", async () => {
		const m = statefulDb(grown());
		const d = await getExpenseDetail(m.db, GID, EID, "u2");
		if (d.status !== "ok") throw new Error();
		const view = d.expense.shares.find((x) => x.uid === "u3")!;
		expect(view).toMatchObject({ status: "pending", last: { cents: 800, method: "self", partial: false }, canUndoOwnPart: false });
		const st = fakeStore();
		const r = await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, st, undefined, await paidNow(m.db, "u3"));
		expect(r.status).toBe("ok");
		const u3 = m.doc.shares.find((x) => x.uid === "u3")!;
		expect(u3).toMatchObject({ paidCents: 200, parts: [expect.objectContaining({ id: "p1", cents: 200 })] });
		expect(u3).not.toHaveProperty("receipt");
		expect(st.delete).toHaveBeenCalledWith([rcp("r80").key]);
	});
	it("B: a própria pessoa não desfaz quando o último pagamento é a quitação, nem quando o último parcial foi marcado por outro", async () => {
		const m = statefulDb(grown());
		expect(await setSharePaid(m.db, GID, EID, "u3", "u3", "pending")).toEqual({ status: "forbidden" });
		const m2 = statefulDb(expense({ shares: [S("u2", 1500), S("u3", 1500, 300, { parts: [part("p1", 200, "2026-11-01T10:00:00Z"), part("p2", 100, "2026-11-02T10:00:00Z", undefined, "u2", "manual")] })] }));
		expect(await setSharePaid(m2.db, GID, EID, "u3", "u3", "pending")).toEqual({ status: "forbidden" });
		expect(m2.expenses.updateOne).not.toHaveBeenCalled();
		const d = await getExpenseDetail(m2.db, GID, EID, "u3");
		if (d.status !== "ok") throw new Error();
		expect(d.expense.shares.find((x) => x.uid === "u3")).toMatchObject({ canUndoOwnPart: false, last: { cents: 100, method: "manual", partial: true } });
	});
	it("part-receipt: pid de outra parte, de outra despesa e inexistente dão o mesmo not_found", async () => {
		const m = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 200, { parts: [part("pu3", 200, "2026-11-01T10:00:00Z", rcp("r3"))] }), S("u1", 1000, 300, { parts: [part("pu1", 300, "2026-11-01T10:00:00Z", rcp("r1"), "u1")] })] }));
		const ref = (target: string, pid: string, eid = EID) => getReceiptRef(m.db, GID, eid, target, "u2", "payment", pid);
		expect(await ref("u3", "pu3")).toMatchObject({ status: "ok" });
		const notFound = { status: "not_found" };
		expect(await ref("u3", "pu1")).toEqual(notFound); // parcial de OUTRA parte da mesma despesa
		expect(await ref("u3", "nao-existe")).toEqual(notFound);
		// outra despesa (o mock devolve a mesma por id; o pid precisa estar na parte pedida): pid que só existe lá
		expect(await getReceiptRef(m.db, GID, EID, "u1", "u2", "payment", "pu3")).toEqual(notFound);
		// parcial SEM comprovante também é not_found
		const m2 = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 200, { parts: [part("sem", 200, "2026-11-01T10:00:00Z")] })] }));
		expect(await getReceiptRef(m2.db, GID, EID, "u3", "u2", "payment", "sem")).toEqual(notFound);
	});
});

describe("segunda rodada: ordem de registro, desfazer com conferência, modelo antigo e troca de comprovante", () => {
	const png = (n: number) => ({ name: `p${n}.png`, contentType: "image/png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, n]) });
	const rcp = (id: string) => ({ id, key: `receipts/${id}`, name: `${id}.png`, contentType: "image/png", size: 4 });
	const u3 = (m: { doc: { shares: Share[] } }) => m.doc.shares.find((x) => x.uid === "u3")!;

	it("1: o upload demora, o dono registra um parcial depois e a quitação grava com paidAt anterior: o último continua sendo a quitação", async () => {
		const m = statefulDb(expense());
		const T0 = new Date("2026-11-11T12:00:00Z");
		const T1 = new Date("2026-11-11T12:00:30Z");
		// a pessoa tocou em "Já paguei" em T0 (now fixado antes do upload); o dono registra R$ 4,00 em T1 > T0 enquanto o arquivo sobe
		let released: () => void = () => {};
		const gate = new Promise<void>((r) => (released = r));
		const store = fakeStore();
		store.put.mockImplementation(async () => {
			await gate;
		});
		const pending = markSelfPaid(m.db, store, { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", file: png(1), now: T0 });
		await new Promise((r) => setTimeout(r, 5));
		expect((await setSharePaid(m.db, GID, EID, "u2", "u3", "paid", T1, undefined, 400, 0)).status).toBe("ok");
		released();
		const r = await pending;
		expect(r.status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 1000, method: "self", markedBy: "u3", paidAt: T0 });
		expect(u3(m).parts).toHaveLength(1);
		const d = await getExpenseDetail(m.db, GID, EID, "u2");
		if (d.status !== "ok") throw new Error();
		expect(d.expense.shares.find((x) => x.uid === "u3")!.last).toMatchObject({ cents: 600, method: "self", partial: false });
		// desfazer tira a quitação (último registrado), não o parcial do dono
		expect((await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, fakeStore(), undefined, 1000)).status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 400, parts: [expect.objectContaining({ cents: 400, method: "manual" })] });
	});
	it("2: desfazer com expectedPaidCents divergente => stale_undo, sem desfazer; sem o campo e com parciais => stale_undo; sem parciais segue", async () => {
		const part = { id: "p1", cents: 300, at: new Date("2026-11-01T10:00:00Z"), markedBy: "u3", method: "self" as const, receipt: rcp("r1") };
		const m = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 300, { parts: [part] })] }));
		const st = fakeStore();
		expect(await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, st, undefined, 0)).toEqual({ status: "stale_undo" });
		expect(await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, st)).toEqual({ status: "stale_undo" });
		expect(await setSharePaid(m.db, GID, EID, "u3", "u3", "pending", undefined, st, undefined, 999)).toEqual({ status: "stale_undo" }); // a própria pessoa também confere
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		expect(st.delete).not.toHaveBeenCalled();
		expect((await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, st, undefined, 300)).status).toBe("ok");
		expect(st.delete).toHaveBeenCalledWith([rcp("r1").key]);
		// parte sem parciais: o cliente antigo (sem o campo) segue como hoje
		const m2 = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { paidAt: new Date(), markedBy: "u2", method: "manual" })] }));
		expect((await setSharePaid(m2.db, GID, EID, "u2", "u3", "pending")).status).toBe("ok");
		expect(u3(m2)).toEqual({ uid: "u3", amountCents: 1000, paidCents: 0 });
	});
	it("2: duas telas desfazendo o mesmo pagamento: a segunda leva stale_undo e não desfaz o anterior", async () => {
		const mk = (id: string, cents: number) => ({ id, cents, at: new Date("2026-11-01T10:00:00Z"), markedBy: "u3", method: "self" as const });
		const m = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 300, { parts: [mk("p1", 100), mk("p2", 200)] })] }));
		expect((await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, undefined, undefined, 300)).status).toBe("ok");
		expect(await setSharePaid(m.db, GID, EID, "u2", "u3", "pending", undefined, undefined, undefined, 300)).toEqual({ status: "stale_undo" });
		expect(u3(m).paidCents).toBe(100);
	});
	it("3: parte do modelo antigo (paga sem metadados) aparece como paga, aceita parcial depois de crescer e mantém o valor", async () => {
		const m = statefulDb(expense({ amountCents: 4500, shares: [S("u2", 1500), S("u3", 1500, 1000)] })); // pagou 10,00 antes de a parte crescer para 15,00
		const before = await getExpenseDetail(m.db, GID, EID, "u3");
		if (before.status !== "ok") throw new Error();
		expect(before.expense.shares.find((x) => x.uid === "u3")).toMatchObject({ status: "pending", paidCents: 1000, dueCents: 500, paidAt: null, parts: [], last: { cents: 1000, method: null, partial: false } });
		const r = await markSelfPaid(m.db, fakeStore(), { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", amountCents: 200, expectedPaidCents: 1000 });
		expect(r.status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 1200 });
		expect(u3(m).parts!.map((p) => p.cents)).toEqual([1000, 200]);
		// desfazer o parcial devolve ao legado
		expect((await setSharePaid(m.db, GID, EID, "u3", "u3", "pending", undefined, undefined, undefined, 1200)).status).toBe("ok");
		expect(u3(m)).toMatchObject({ paidCents: 1000, parts: [expect.objectContaining({ cents: 1000 })] }); // o antigo ficou como parcial "sem dono": só o dono desfaz
	});
	it("5: a própria pessoa não substitui (nem apaga) o comprovante de um pagamento marcado por outra pessoa; o arquivo enviado é removido", async () => {
		const mine = { id: "p1", cents: 600, at: new Date("2026-11-01T10:00:00Z"), markedBy: "u3", method: "self" as const, receipt: rcp("meu") };
		const dono = { id: "p2", cents: 400, at: new Date("2026-11-02T10:00:00Z"), markedBy: "u2", method: "manual" as const, receipt: rcp("dono") };
		const m = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { parts: [mine, dono] })] }));
		const st = fakeStore();
		const r = await markSelfPaid(m.db, st, { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", file: png(9) });
		expect(r.status).toBe("ok");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		expect(u3(m).parts!.map((p) => p.receipt?.id)).toEqual(["meu", "dono"]);
		expect(st.put).toHaveBeenCalledTimes(1);
		expect(st.delete).toHaveBeenCalledTimes(1); // só o arquivo recém-enviado
		expect(st.delete.mock.calls[0][0]).not.toContain(rcp("dono").key);
		// mesma regra para o pagamento de topo manual com comprovante
		const m2 = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 1000, { paidAt: new Date(), markedBy: "u2", method: "manual", receipt: rcp("dono") })] }));
		const st2 = fakeStore();
		await markSelfPaid(m2.db, st2, { groupId: GID, eid: EID, uid: "u3", targetUid: "u3", file: png(8) });
		expect(u3(m2).receipt).toEqual(rcp("dono"));
		expect(st2.delete).toHaveBeenCalledTimes(1);
		// e a tela não oferece "Trocar comprovante" nesse caso
		const d = await getExpenseDetail(m2.db, GID, EID, "u3");
		if (d.status !== "ok") throw new Error();
		expect(d.expense.shares.find((x) => x.uid === "u3")!.canAddReceipt).toBe(false);
	});
});

describe("parts malformado no banco", () => {
	it("a despesa continua abrindo (sem 500) e ignora o que não é parcial válido", async () => {
		for (const parts of ["x", [null, 7, { id: "p" }], {}]) {
			const m = statefulDb(expense({ shares: [S("u2", 1000), S("u3", 1000, 0, { parts } as never)] }));
			const d = await getExpenseDetail(m.db, GID, EID, "u2");
			if (d.status !== "ok") throw new Error("esperava ok");
			expect(d.expense.shares.find((x) => x.uid === "u3")).toMatchObject({ parts: [], last: null, status: "pending" });
		}
	});
});

