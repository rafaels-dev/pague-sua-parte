import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { AttachmentStore } from "@/lib/storage/attachments";

const { createExpense, deleteExpense, getExpenseDetail, getSummary, listExpenses, setSharePaid, updateParticipants } = await import("./repo");
const { balanceOf, normalizeShare, hasPayments, shareStatus } = await import("./shares");

const GID = "507f1f77bcf86cd799439011";
const EID = "507f1f77bcf86cd799439022";
const PIX = { type: "cpf", key: "52998224725" };
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const managed = (uid: string, name: string, managedBy: string, pixKey?: typeof PIX) => ({
	...member(uid),
	kind: "managed" as const,
	name,
	managedBy,
	...(pixKey ? { pixKey } : {}),
});
// u1 admin; u2 Renata cuida de m_ben (com Pix); u3 Caio cuida de m_vo (sem Pix)
const members = () => [member("u1", "admin"), member("u2"), member("u3"), managed("m_ben", "Benjamim", "u2", PIX), managed("m_vo", "Vó", "u3")];
const S = (uid: string, amountCents: number, paidCents = 0) => ({ uid, amountCents, paidCents });
// despesa paga por Benjamim (sem login), dividida entre ele, u1 e u2
const benExpense = (over: Record<string, unknown> = {}) => ({
	_id: new ObjectId(EID),
	groupId: new ObjectId(GID),
	createdBy: "u2",
	paidBy: "m_ben",
	description: "Farmácia",
	amountCents: 3000,
	date: "2026-11-10",
	pix: { ...PIX, payeeName: "Benjamim" },
	shares: [S("m_ben", 1000), S("u1", 1000), S("u2", 1000)],
	version: 0,
	attachments: [],
	createdAt: new Date("2026-11-10T10:00:00Z"),
	updatedAt: new Date(),
	...over,
});

function mockDb(o: { members?: ReturnType<typeof members>; expense?: unknown; expenses?: unknown[]; agg?: unknown[]; matched?: number } = {}) {
	const group = { _id: new ObjectId(GID), name: "Família", members: o.members ?? members() };
	const groups = {
		// findOne({"members.uid": caller}) só devolve o grupo se o chamador é membro
		findOne: vi.fn(async (f: Record<string, unknown>) => (group.members.some((m) => m.uid === f["members.uid"]) ? group : null)),
		find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([group]) }),
	};
	const users = {
		findOne: vi.fn().mockResolvedValue({ _id: "u2", name: "Renata", pixKey: { type: "email", key: "r@x.com" } }),
		find: vi.fn().mockReturnValue({
			toArray: vi.fn().mockResolvedValue([{ _id: "u1", name: "Ana" }, { _id: "u2", name: "Renata" }, { _id: "u3", name: "Caio" }]),
		}),
	};
	const cursor = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(o.expenses ?? []) };
	const expenses = {
		findOne: vi.fn().mockResolvedValue("expense" in o ? o.expense : benExpense()),
		find: vi.fn().mockReturnValue(cursor),
		insertOne: vi.fn().mockResolvedValue({}),
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
	return { db, groups, users, expenses };
}
const store = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), delete: vi.fn() } satisfies AttachmentStore;
const base = { description: "Farmácia", amountCents: 3000, date: "2026-11-10", participantUids: ["m_ben", "u1", "u2"] };
const create = (db: Db, uid: string, over: Record<string, unknown> = {}) =>
	createExpense(db, store, { groupId: GID, uid, input: { ...base, ...over } as never, files: [] });

beforeEach(() => vi.clearAllMocks());

describe("createExpense com paidByUid", () => {
	it("responsável lança por quem cuida: paidBy sem login, createdBy ele, Pix e nome da pessoa", async () => {
		const { db, expenses, users } = mockDb();
		const r = await create(db, "u2", { paidByUid: "m_ben" });
		expect(r.status).toBe("ok");
		const doc = expenses.insertOne.mock.calls[0][0];
		expect(doc).toMatchObject({ paidBy: "m_ben", createdBy: "u2", pix: { type: "cpf", key: PIX.key, payeeName: "Benjamim" } });
		expect(doc.shares.map((s: { uid: string }) => s.uid)).toEqual(["m_ben", "u1", "u2"]);
		expect(users.findOne).not.toHaveBeenCalled(); // não usa a chave do responsável
		if (r.status === "ok") expect(r.expense).toMatchObject({ canMarkPaid: true, canEditParticipants: true, canDelete: true, paidBy: { uid: "m_ben", kind: "managed", youManage: true, isYou: false } });
	});
	it("o próprio uid em paidByUid é o fluxo normal (chave do usuário)", async () => {
		const { db, expenses } = mockDb();
		await create(db, "u2", { paidByUid: "u2" });
		expect(expenses.insertOne.mock.calls[0][0]).toMatchObject({ paidBy: "u2", pix: { key: "r@x.com" } });
	});
	it("não lança como quem não cuida: outro responsável, outro membro real, uid inexistente, nunca m_ de outro", async () => {
		for (const [caller, paidByUid] of [["u3", "m_ben"], ["u1", "m_ben"], ["u2", "u3"], ["u2", "m_inexistente"], ["u2", "m_vo"]] as const) {
			const { db, expenses } = mockDb();
			expect(await create(db, caller, { paidByUid })).toMatchObject({ status: "invalid", field: "paidByUid" });
			expect(expenses.insertOne).not.toHaveBeenCalled();
		}
	});
	it("até admin só lança por quem cuida (admin não é responsável)", async () => {
		expect(await create(mockDb().db, "u1", { paidByUid: "m_ben" })).toMatchObject({ status: "invalid", field: "paidByUid" });
	});
	it("pessoa sem chave Pix: no_pix com o nome", async () => {
		const { db, expenses } = mockDb();
		expect(await create(db, "u3", { paidByUid: "m_vo", participantUids: ["m_vo", "u1"] })).toEqual({ status: "no_pix", name: "Vó" });
		expect(expenses.insertOne).not.toHaveBeenCalled();
	});
	it("pessoa sem login pode ser participante", async () => {
		const { db, expenses } = mockDb();
		expect((await create(db, "u2", { participantUids: ["u2", "m_ben", "m_vo"] })).status).toBe("ok");
		expect(expenses.insertOne.mock.calls[0][0].shares.map((s: { uid: string }) => s.uid)).toEqual(["u2", "m_ben", "m_vo"]);
	});
	it("participante que saiu do grupo é recusado", async () => {
		expect(await create(mockDb().db, "u2", { participantUids: ["u2", "m_saiu"] })).toMatchObject({ status: "invalid", field: "participantUids" });
	});
});

describe("permissões de dono quando o pagador é sem login", () => {
	it("responsável marca como pago (markedBy = ele) e desfaz", async () => {
		const { db, expenses } = mockDb();
		const r = await setSharePaid(db, GID, EID, "u2", "u1", "paid");
		expect(r.status).toBe("ok");
		const written = expenses.updateOne.mock.calls[0][1].$set.shares.find((s: { uid: string }) => s.uid === "u1");
		expect(written).toMatchObject({ paidCents: 1000, markedBy: "u2", method: "manual" });
		expect(expenses.updateOne.mock.calls[0][0]).toMatchObject({ paidBy: "m_ben" });
	});
	it("mudar participantes: responsável sim; quem não cuida não; admin não", async () => {
		expect((await updateParticipants(mockDb().db, GID, EID, "u2", ["m_ben", "u1"])).status).toBe("ok");
		for (const who of ["u3", "u1"]) expect((await updateParticipants(mockDb().db, GID, EID, who, ["m_ben", "u1"])).status).toBe("forbidden");
	});
	it("marcar pago: outro membro e admin → forbidden, nada gravado", async () => {
		for (const who of ["u3", "u1"]) {
			const { db, expenses } = mockDb();
			expect((await setSharePaid(db, GID, EID, who, "u2", "paid")).status).toBe("forbidden");
			expect(expenses.updateOne).not.toHaveBeenCalled();
		}
	});
	it("não membro: no_group", async () => {
		expect((await setSharePaid(mockDb().db, GID, EID, "estranho", "u1", "paid")).status).toBe("no_group");
		expect((await updateParticipants(mockDb().db, GID, EID, "estranho", ["u1"])).status).toBe("no_group");
	});
	it("responsável substituído perde o acesso na hora (avaliado no grupo atual)", async () => {
		const trocado = members().map((m) => (m.uid === "m_ben" ? { ...m, managedBy: "u3" } : m));
		const old = mockDb({ members: trocado });
		expect((await setSharePaid(old.db, GID, EID, "u2", "u1", "paid")).status).toBe("forbidden");
		expect((await updateParticipants(mockDb({ members: trocado }).db, GID, EID, "u2", ["m_ben"])).status).toBe("forbidden");
		expect((await deleteExpense(mockDb({ members: trocado }).db, store, GID, EID, "u2")).status).toBe("forbidden");
		const detail = await getExpenseDetail(mockDb({ members: trocado }).db, GID, EID, "u2");
		expect(detail.status === "ok" && detail.expense).toMatchObject({ canMarkPaid: false, canEditParticipants: false, canDelete: false });
		// o novo responsável passa a poder
		expect((await setSharePaid(mockDb({ members: trocado }).db, GID, EID, "u3", "u1", "paid")).status).toBe("ok");
	});
	it("pagador removido do grupo: ninguém age por ele (só o admin apaga)", async () => {
		const semBen = members().filter((m) => m.uid !== "m_ben");
		expect((await setSharePaid(mockDb({ members: semBen }).db, GID, EID, "u2", "u1", "paid")).status).toBe("forbidden");
		expect((await deleteExpense(mockDb({ members: semBen }).db, store, GID, EID, "u2")).status).toBe("forbidden");
		expect((await deleteExpense(mockDb({ members: semBen }).db, store, GID, EID, "u1")).status).toBe("ok");
	});
	it("apagar: responsável e admin sim; outro membro não; com pagamento 409", async () => {
		expect((await deleteExpense(mockDb().db, store, GID, EID, "u2")).status).toBe("ok");
		expect((await deleteExpense(mockDb().db, store, GID, EID, "u1")).status).toBe("ok");
		expect((await deleteExpense(mockDb().db, store, GID, EID, "u3")).status).toBe("forbidden");
		const paid = benExpense({ shares: [S("m_ben", 1000), S("u1", 1000, 1000), S("u2", 1000)] });
		expect((await deleteExpense(mockDb({ expense: paid }).db, store, GID, EID, "u2")).status).toBe("has_payment");
	});
	it("despesa de usuário real continua sendo só dele (e admin apaga)", async () => {
		const real = benExpense({ paidBy: "u3", createdBy: "u3", shares: [S("u3", 1500), S("u2", 1500)] });
		expect((await setSharePaid(mockDb({ expense: real }).db, GID, EID, "u2", "u3", "paid")).status).toBe("forbidden"); // Renata não cuida de Caio
		expect((await setSharePaid(mockDb({ expense: real }).db, GID, EID, "u3", "u2", "paid")).status).toBe("ok");
		expect((await deleteExpense(mockDb({ expense: real }).db, store, GID, EID, "u2")).status).toBe("forbidden");
	});
});

describe("detalhe e lista", () => {
	it("detalhe: nomes de sem login vêm do grupo; kind/youManage/managedByName; isYou só para o chamador", async () => {
		const r = await getExpenseDetail(mockDb().db, GID, EID, "u2");
		if (r.status !== "ok") throw new Error("esperava ok");
		expect(r.expense.paidBy).toEqual({ uid: "m_ben", name: "Benjamim", picture: null, isYou: false, kind: "managed", youManage: true });
		const ben = r.expense.shares.find((s) => s.uid === "m_ben")!;
		expect(ben).toMatchObject({ kind: "managed", youManage: true, managedByName: "Renata", isYou: false, status: "payer" });
		expect(r.expense.shares.find((s) => s.uid === "u2")).toMatchObject({ isYou: true, kind: "user", youManage: false, managedByName: null });
	});
	it("detalhe para quem não cuida: youManage falso; pessoa que saiu vira Participante", async () => {
		const semBen = members().filter((m) => m.uid !== "m_ben");
		const r = await getExpenseDetail(mockDb({ members: semBen }).db, GID, EID, "u3");
		if (r.status !== "ok") throw new Error("esperava ok");
		expect(r.expense.paidBy).toMatchObject({ name: "Participante", kind: "managed", youManage: false });
		expect(r.expense).toMatchObject({ canMarkPaid: false, canDelete: false });
	});
	it("lista: managed (cotas de quem cuido, não do dono), ownerView quando ajo pelo dono; your* só do chamador", async () => {
		const e = benExpense({ shares: [S("m_ben", 1000), S("u1", 1000), S("u2", 1000, 400), S("m_vo", 500)] });
		const { db } = mockDb({ expenses: [e] });
		const [asRenata] = (await listExpenses(db, GID, "u2"))!;
		expect(asRenata.paidBy).toMatchObject({ uid: "m_ben", youManage: true, isYou: false });
		expect(asRenata.managed).toEqual([]); // a cota do dono não entra; Renata não cuida de Vó
		expect(asRenata.ownerView).toEqual({ pendingCount: 3, refundCount: 0 });
		expect(asRenata).toMatchObject({ yourStatus: "pending", yourDueCents: 600 });
		const [asCaio] = (await listExpenses(mockDb({ expenses: [e] }).db, GID, "u3"))!;
		expect(asCaio.managed).toEqual([{ uid: "m_vo", name: "Vó", status: "pending", dueCents: 500, refundCents: 0 }]);
		expect(asCaio.ownerView).toBeNull();
		expect(asCaio).toMatchObject({ yourStatus: "none", yourDueCents: 0 });
	});
	it("lista: devolução de quem cuido aparece em managed com refundCents", async () => {
		const e = benExpense({ paidBy: "u1", shares: [S("u1", 1500), S("m_ben", 0, 700)] });
		const [asRenata] = (await listExpenses(mockDb({ expenses: [e] }).db, GID, "u2"))!;
		expect(asRenata.managed).toEqual([{ uid: "m_ben", name: "Benjamim", status: "refund", dueCents: 0, refundCents: 700 }]);
		expect(asRenata.ownerView).toBeNull();
	});
	it("nunca carrega o documento de users de uma pessoa sem login", async () => {
		const { db, users } = mockDb({ expenses: [benExpense()] });
		await listExpenses(db, GID, "u2");
		expect(users.find).not.toHaveBeenCalled(); // pagador é sem login: nada a buscar
		await getExpenseDetail(db, GID, EID, "u2");
		const ids: string[] = users.find.mock.calls[0][0]._id.$in;
		expect(ids).not.toContain("m_ben");
		expect(ids).toContain("u2"); // o responsável é carregado para mostrar o nome
	});
});

describe("getSummary com pessoas sem login", () => {
	const G = new ObjectId(GID);
	it("totais só do chamador; managed de quem cuido AGORA, zeros incluídos; UMA agregação", async () => {
		const { db, expenses } = mockDb({
			agg: [
				{ _id: { g: G, u: "u2" }, toPay: 300, toReceive: 100, toPayNow: 200, toReceiveNow: 100, overdue: 50 },
				{ _id: { g: G, u: "m_ben" }, toPay: 50, toReceive: 2000, toPayNow: 50, toReceiveNow: 1500, overdue: 0 },
			],
		});
		expect(await getSummary(db, "u2")).toEqual({
			toReceiveCents: 100,
			toPayCents: 300,
			toReceiveNowCents: 100,
			toPayNowCents: 200,
			overdueToPayCents: 50,
			managed: [{ uid: "m_ben", name: "Benjamim", groupId: GID, groupName: "Família", toReceiveCents: 2000, toPayCents: 50, toReceiveNowCents: 1500, toPayNowCents: 50, overdueToPayCents: 0 }],
		});
		expect(expenses.aggregate).toHaveBeenCalledTimes(1);
		const pipeline = expenses.aggregate.mock.calls[0][0];
		expect(pipeline[0].$match.$or).toEqual([{ paidBy: { $in: ["u2", "m_ben"] } }, { "shares.uid": { $in: ["u2", "m_ben"] } }]);
		expect(JSON.stringify(pipeline)).toContain('"$literal":["u2","m_ben"]');
	});
	it("entrada com zeros continua listada; quem não é responsável não vê a pessoa", async () => {
		const mine = await getSummary(mockDb().db, "u3");
		expect(mine.managed).toEqual([{ uid: "m_vo", name: "Vó", groupId: GID, groupName: "Família", toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 }]);
		expect((await getSummary(mockDb().db, "u1")).managed).toEqual([]);
	});
	it("responsável substituído deixa de ver a pessoa no resumo", async () => {
		const trocado = members().map((m) => (m.uid === "m_ben" ? { ...m, managedBy: "u3" } : m));
		expect((await getSummary(mockDb({ members: trocado }).db, "u2")).managed).toEqual([]);
		expect((await getSummary(mockDb({ members: trocado }).db, "u3")).managed.map((m) => m.uid).sort()).toEqual(["m_ben", "m_vo"]);
	});
});

describe("modelo antigo (status 'paid', sem paidCents)", () => {
	const legacy = () =>
		benExpense({
			paidBy: "u2",
			createdBy: "u2",
			shares: [{ uid: "u2", amountCents: 1000 }, { uid: "u1", amountCents: 1000, status: "paid" }, { uid: "u3", amountCents: 1000, status: "pending" }],
		});
	it("normalizeShare: paid vale a cota inteira; outro vale 0; status some; modelo novo intacto", () => {
		expect(normalizeShare({ uid: "a", amountCents: 700, status: "paid" } as never)).toEqual({ uid: "a", amountCents: 700, paidCents: 700 });
		expect(normalizeShare({ uid: "a", amountCents: 700, status: "pending" } as never)).toEqual({ uid: "a", amountCents: 700, paidCents: 0 });
		const novo = { uid: "a", amountCents: 700, paidCents: 100 };
		expect(normalizeShare(novo)).toBe(novo);
	});
	it("apagar → has_payment; o filtro atômico também protege", async () => {
		const m = mockDb({ expense: legacy() });
		expect((await deleteExpense(m.db, store, GID, EID, "u2")).status).toBe("has_payment");
		expect(m.expenses.deleteOne).not.toHaveBeenCalled();
		// se a leitura não pegasse, o filtro do deleteOne pega: simula corrida
		const race = mockDb({ expense: benExpense({ paidBy: "u2", shares: [S("u2", 1000), S("u1", 1000)] }) });
		race.expenses.deleteOne.mockResolvedValue({ deletedCount: 0 });
		expect((await deleteExpense(race.db, store, GID, EID, "u2")).status).toBe("has_payment");
		expect(race.expenses.deleteOne.mock.calls[0][0].shares).toEqual({ $not: { $elemMatch: { $or: [{ paidCents: { $gt: 0 } }, { status: "paid" }] } } });
	});
	it("status deriva como paid e hasPayments enxerga", async () => {
		expect(hasPayments(legacy() as never)).toBe(true);
		const r = await getExpenseDetail(mockDb({ expense: legacy() }).db, GID, EID, "u2");
		if (r.status !== "ok") throw new Error("ok");
		expect(r.expense.shares.find((s) => s.uid === "u1")).toMatchObject({ status: "paid", paidCents: 1000, dueCents: 0 });
		expect(r.expense.shares.find((s) => s.uid === "u3")).toMatchObject({ status: "pending", dueCents: 1000 });
		expect(r.expense.canDelete).toBe(false);
		expect(shareStatus(normalizeShare({ uid: "u1", amountCents: 1000, status: "paid" } as never), "u2")).toBe("paid");
		const [item] = (await listExpenses(mockDb({ expenses: [legacy()] }).db, GID, "u3"))!;
		expect(item).toMatchObject({ pendingCount: 1 });
	});
	it("saldos (referência em JS) excluem a cota legada já paga", () => {
		expect(balanceOf([legacy() as never], "u2")).toEqual({ toReceiveCents: 1000, toPayCents: 0, toReceiveNowCents: 1000, toPayNowCents: 0, overdueToPayCents: 0 });
		expect(balanceOf([legacy() as never], "u1")).toEqual({ toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 });
	});
	it("a agregação lê o status antigo (sem paidCents numérico)", async () => {
		const { db, expenses } = mockDb();
		await getSummary(db, "u2");
		const text = JSON.stringify(expenses.aggregate.mock.calls[0][0]);
		expect(text).toContain('"$isNumber":"$shares.paidCents"');
		expect(text).toContain('"$eq":["$shares.status","paid"]');
	});
	it("marcar pago em documento legado grava o modelo novo (sem status)", async () => {
		const m = mockDb({ expense: legacy() });
		await setSharePaid(m.db, GID, EID, "u2", "u3", "paid");
		const shares = m.expenses.updateOne.mock.calls[0][1].$set.shares;
		expect(shares.every((s: Record<string, unknown>) => typeof s.paidCents === "number" && !("status" in s))).toBe(true);
	});
});
