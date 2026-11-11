import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { AttachmentStore } from "@/lib/storage/attachments";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
const { createExpense, deleteExpense, getAttachmentRef, getExpenseDetail, getSummary, listExpenses, setSharePaid } = await import("./repo");

const GID = "507f1f77bcf86cd799439011";
const EID = "507f1f77bcf86cd799439022";
const AID = "a".repeat(32);
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const group = () => ({ _id: new ObjectId(GID), name: "G", members: [member("u1", "admin"), member("u2"), member("u3")] });
const PIX = { type: "email", key: "ana@x.com" };

type Share = { uid: string; amountCents: number; status: "payer" | "pending" | "paid" };
const expense = (over: Record<string, unknown> = {}) => ({
	_id: new ObjectId(EID),
	groupId: new ObjectId(GID),
	createdBy: "u2",
	paidBy: "u2",
	description: "Mercado",
	amountCents: 3000,
	date: "2026-11-10",
	pix: { ...PIX, payeeName: "Beto" },
	shares: [
		{ uid: "u2", amountCents: 1000, status: "payer" },
		{ uid: "u1", amountCents: 1000, status: "pending" },
		{ uid: "u3", amountCents: 1000, status: "pending" },
	] as Share[],
	attachments: [{ id: AID, key: "groups/g/e/" + AID, name: "nota.pdf", contentType: "application/pdf", size: 10 }],
	createdAt: new Date("2026-11-10T10:00:00Z"),
	updatedAt: new Date(),
	...over,
});

function mockDb(o: { group?: unknown; payer?: unknown; expense?: unknown; expenses?: unknown[]; agg?: unknown[]; insertError?: Error; matched?: number } = {}) {
	const groups = {
		findOne: vi.fn().mockResolvedValue("group" in o ? o.group : group()),
		find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(GID) }]) }),
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
		aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(o.agg ?? []) }),
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
			{ uid: "u1", amountCents: 1000, status: "payer" },
			{ uid: "u2", amountCents: 1000, status: "pending" },
			{ uid: "u3", amountCents: 1000, status: "pending" },
		]);
		expect(doc.attachments).toHaveLength(1);
		expect(doc.attachments[0].key).toBe(`groups/${GID}/${doc._id.toHexString()}/${doc.attachments[0].id}`);
		expect(store.put).toHaveBeenCalledOnce();
	});
	it("quem paga fora da divisão não ganha cota", async () => {
		const { db, expenses } = mockDb();
		await create(db, fakeStore(), { participantUids: ["u2", "u3"] }, []);
		expect(expenses.insertOne.mock.calls[0][0].shares.map((s: Share) => s.status)).toEqual(["pending", "pending"]);
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
	it("só o próprio usuário como participante", async () => {
		expect(await create(mockDb().db, fakeStore(), { participantUids: ["u1"] })).toMatchObject({ status: "invalid", field: "participantUids" });
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
	it("yourStatus para pagador, devedor e não participante; ordenação e limite", async () => {
		const noPart = expense({ _id: new ObjectId(), shares: [{ uid: "u2", amountCents: 500, status: "payer" }, { uid: "u3", amountCents: 500, status: "pending" }] });
		const mine = expense({ _id: new ObjectId(), paidBy: "u1", createdBy: "u1", shares: [{ uid: "u1", amountCents: 1000, status: "payer" }, { uid: "u2", amountCents: 1000, status: "paid" }, { uid: "u3", amountCents: 1000, status: "pending" }] });
		const m = mockDb({ expenses: [expense(), noPart, mine] });
		const list = (await listExpenses(m.db, GID, "u1"))!;
		expect(m.cursor.sort).toHaveBeenCalledWith({ date: -1, createdAt: -1, _id: -1 });
		expect(m.cursor.limit).toHaveBeenCalledWith(100);
		expect(list[0]).toMatchObject({ yourStatus: "pending", yourShareCents: 1000, pendingCount: 2, attachmentCount: 1, paidBy: { uid: "u2", name: "Beto", isYou: false } });
		expect(list[1]).toMatchObject({ yourStatus: "none", yourShareCents: 0, pendingCount: 1, attachmentCount: 1 });
		expect(list[2]).toMatchObject({ yourStatus: "payer", yourShareCents: 1000, pendingCount: 1, paidBy: { name: "Aninha", isYou: true } });
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
		expect(await get("u1", expense({ shares: [{ uid: "u1", amountCents: 1, status: "paid" }] }))).toBe(false);
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
		expect(await deleteExpense(m.db, store, GID, EID, "u2")).toEqual({ status: "ok" });
		expect(m.expenses.deleteOne).toHaveBeenCalledWith(expect.objectContaining({ "shares.status": { $ne: "paid" } }));
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
		const paid = expense({ shares: [{ uid: "u2", amountCents: 1, status: "payer" }, { uid: "u1", amountCents: 1, status: "paid" }] });
		const store = fakeStore();
		expect((await deleteExpense(mockDb({ expense: paid }).db, store, GID, EID, "u2")).status).toBe("has_payment");
		const race = mockDb();
		race.expenses.deleteOne.mockResolvedValue({ deletedCount: 0 });
		expect((await deleteExpense(race.db, store, GID, EID, "u2")).status).toBe("has_payment");
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("não membro / inexistente", async () => {
		expect((await deleteExpense(mockDb({ group: null }).db, fakeStore(), GID, EID, "x")).status).toBe("no_group");
		expect((await deleteExpense(mockDb({ expense: null }).db, fakeStore(), GID, EID, "u1")).status).toBe("no_expense");
	});
});

describe("getSummary", () => {
	it("zero sem grupos, sem consultar despesas", async () => {
		const m = mockDb();
		m.groups.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
		expect(await getSummary(m.db, "u1")).toEqual({ toReceiveCents: 0, toPayCents: 0 });
		expect(m.expenses.aggregate).not.toHaveBeenCalled();
	});
	it("mapeia o resultado da agregação e restringe aos grupos atuais", async () => {
		const m = mockDb({ agg: [{ _id: null, toPay: 700, toReceive: 2500 }] });
		expect(await getSummary(m.db, "u1")).toEqual({ toReceiveCents: 2500, toPayCents: 700 });
		const pipeline = m.expenses.aggregate.mock.calls[0][0];
		expect(pipeline[0].$match.groupId.$in).toHaveLength(1);
		expect(JSON.stringify(pipeline)).toContain('"pending"');
		expect(m.groups.find).toHaveBeenCalledWith({ "members.uid": "u1" }, expect.anything());
	});
	it("sem cotas pendentes: zeros", async () => {
		expect(await getSummary(mockDb().db, "u1")).toEqual({ toReceiveCents: 0, toPayCents: 0 });
	});
});

describe("detalhe: pagamento manual", () => {
	const paidAt = new Date("2026-11-11T12:00:00Z");
	const withPaid = () =>
		expense({
			shares: [
				{ uid: "u2", amountCents: 1000, status: "payer" },
				{ uid: "u1", amountCents: 1000, status: "paid", paidAt, markedBy: "u2", method: "manual" },
				{ uid: "u3", amountCents: 1000, status: "pending" },
			],
		});
	it("expõe canMarkPaid, paidAt e method", async () => {
		const get = async (uid: string) => {
			const r = await getExpenseDetail(mockDb({ expense: withPaid() }).db, GID, EID, uid);
			if (r.status !== "ok") throw new Error("esperava ok");
			return r.expense;
		};
		const owner = await get("u2");
		expect(owner.canMarkPaid).toBe(true);
		expect(owner.shares.map((s) => [s.paidAt, s.method])).toEqual([
			[null, null],
			[paidAt.toISOString(), "manual"],
			[null, null],
		]);
		expect((await get("u1")).canMarkPaid).toBe(false);
		expect(owner.shares.every((s) => !("markedBy" in s))).toBe(true);
	});
	it("parte paga à mão sai das contas: lista e resumo só contam pendentes", async () => {
		const list = await listExpenses(mockDb({ expenses: [withPaid()] }).db, GID, "u2");
		expect(list?.[0].pendingCount).toBe(1);
		const m = mockDb();
		await getSummary(m.db, "u1");
		const pipeline = m.expenses.aggregate.mock.calls[0][0];
		expect(pipeline).toContainEqual({ $match: { "shares.status": "pending" } });
	});
});

describe("setSharePaid", () => {
	const mark = (db: Db, target = "u1", status: "paid" | "pending" = "paid", uid = "u2", eid = EID, gid = GID) =>
		setSharePaid(db, gid, eid, uid, target, status);

	it("dono marca como pago: um updateOne condicional com paidBy do chamador", async () => {
		const m = mockDb();
		const r = await mark(m.db);
		expect(r.status).toBe("ok");
		expect(m.expenses.updateOne).toHaveBeenCalledTimes(1);
		const [filter, update, opts] = m.expenses.updateOne.mock.calls[0];
		expect(filter).toMatchObject({ _id: new ObjectId(EID), groupId: new ObjectId(GID), paidBy: "u2" });
		expect(filter.shares.$elemMatch).toEqual({ uid: "u1", status: { $ne: "payer" } });
		expect(update.$set).toMatchObject({
			"shares.$[t].status": "paid",
			"shares.$[t].markedBy": "u2",
			"shares.$[t].method": "manual",
		});
		expect(update.$set["shares.$[t].paidAt"]).toBeInstanceOf(Date);
		expect(opts.arrayFilters).toEqual([{ "t.uid": "u1", "t.status": "pending" }]);
	});
	it("devolve o detalhe completo", async () => {
		const r = await mark(mockDb().db);
		if (r.status !== "ok") throw new Error("esperava ok");
		expect(r.expense).toMatchObject({ id: EID, canMarkPaid: true });
		expect(r.expense.shares).toHaveLength(3);
	});
	it("desfazer volta para pending e remove paidAt, markedBy e method", async () => {
		const m = mockDb();
		expect((await mark(m.db, "u1", "pending")).status).toBe("ok");
		const [, update, opts] = m.expenses.updateOne.mock.calls[0];
		expect(update.$set).toMatchObject({ "shares.$[t].status": "pending" });
		expect(Object.keys(update.$unset).sort()).toEqual(["shares.$[t].markedBy", "shares.$[t].method", "shares.$[t].paidAt"]);
		expect(opts.arrayFilters).toEqual([{ "t.uid": "u1", "t.status": "paid" }]);
	});
	it("idempotente: repetir a ação continua ok (casou, mesmo sem alterar)", async () => {
		const m = mockDb();
		expect((await mark(m.db)).status).toBe("ok");
		expect((await mark(m.db)).status).toBe("ok");
		expect((await mark(m.db, "u1", "pending")).status).toBe("ok");
	});
	it("quem não pagou a despesa: forbidden", async () => {
		const m = mockDb({ matched: 0 });
		expect((await mark(m.db, "u3", "paid", "u1")).status).toBe("forbidden");
		expect(m.expenses.updateOne.mock.calls[0][0]).toMatchObject({ paidBy: "u1" });
	});
	it("não membro / grupo inválido: no_group, sem escrever", async () => {
		const m = mockDb({ group: null });
		expect((await mark(m.db, "u1", "paid", "x")).status).toBe("no_group");
		expect((await mark(mockDb().db, "u1", "paid", "u2", EID, "xx")).status).toBe("no_group");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("despesa inexistente ou id malformado: no_expense", async () => {
		expect((await mark(mockDb({ expense: null, matched: 0 }).db)).status).toBe("no_expense");
		const m = mockDb();
		expect((await mark(m.db, "u1", "paid", "u2", "xx")).status).toBe("no_expense");
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
	});
	it("quem não tem cota e a cota de quem pagou: no_share", async () => {
		expect((await mark(mockDb({ matched: 0 }).db, "u9")).status).toBe("no_share");
		expect((await mark(mockDb({ matched: 0 }).db, "u2")).status).toBe("no_share");
	});
});
