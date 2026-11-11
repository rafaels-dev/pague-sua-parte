import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

const { getExpenseDetail, helpExpense, listExpenses, updateParticipants, setSharePaid } = await import("./repo");
const { addHelper, undoShare, recalcShares, isHelper } = await import("./shares");

const GID = "507f1f77bcf86cd799439011";
const EID = "507f1f77bcf86cd799439022";
const NOW = new Date("2026-11-11T12:00:00Z");
const PIX = { type: "cpf", key: "52998224725" };
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const managed = (uid: string, name: string, managedBy: string) => ({ ...member(uid), kind: "managed" as const, name, managedBy });
// u1 admin (paga), u2 e u3 membros, m_vo (avó) cuidada por u2, m_ben cuidado por u3
const members = () => [member("u1", "admin"), member("u2"), member("u3"), managed("m_vo", "Vó", "u2"), managed("m_ben", "Ben", "u3")];
type Sh = { uid: string; amountCents: number; paidCents: number; helped?: boolean; helpedAt?: Date; paidAt?: Date; method?: "manual" };
const S = (uid: string, amountCents: number, paidCents = 0, extra: Partial<Sh> = {}): Sh => ({ uid, amountCents, paidCents, ...extra });
const aloneExpense = (over: Record<string, unknown> = {}) => ({
	_id: new ObjectId(EID),
	groupId: new ObjectId(GID),
	createdBy: "u1",
	paidBy: "u1",
	description: "Luz",
	amountCents: 3000,
	date: "2026-11-10",
	pix: { ...PIX, payeeName: "Ana" },
	shares: [S("u1", 3000)],
	version: 0,
	attachments: [],
	createdAt: new Date("2026-11-10T10:00:00Z"),
	updatedAt: new Date(),
	...over,
});

function mockDb(o: { expense?: unknown; members?: ReturnType<typeof members>; matched?: number | number[] } = {}) {
	const group = { _id: new ObjectId(GID), name: "Família", members: o.members ?? members() };
	const groups = {
		findOne: vi.fn(async (f: Record<string, unknown>) => (group.members.some((m) => m.uid === f["members.uid"]) ? group : null)),
	};
	const users = {
		find: vi.fn().mockReturnValue({
			toArray: vi.fn().mockResolvedValue([{ _id: "u1", name: "Ana" }, { _id: "u2", name: "Renata" }, { _id: "u3", name: "Caio" }]),
		}),
	};
	const matches = Array.isArray(o.matched) ? [...o.matched] : null;
	const cursor = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
	const expenses = {
		findOne: vi.fn().mockResolvedValue("expense" in o ? o.expense : aloneExpense()),
		find: vi.fn().mockReturnValue(cursor),
		updateOne: vi.fn(async () => ({ matchedCount: matches ? (matches.shift() ?? 1) : (o.matched ?? 1) })),
		aggregate: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(o.expense === undefined ? [aloneExpense()] : [o.expense]) })),
	};
	return { db: { collection: (n: string) => ({ groups, users, expenses })[n] } as unknown as Db, expenses };
}
const written = (m: ReturnType<typeof mockDb>) => m.expenses.updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $set: { shares: Sh[] }; $inc: { version: number } }];

beforeEach(() => vi.clearAllMocks());

describe("helpExpense", () => {
	it("um membro entra: divide igualmente, marca helped/helpedAt e sobe a versão", async () => {
		const m = mockDb();
		const r = await helpExpense(m.db, GID, EID, "u2", undefined, NOW);
		expect(r.status).toBe("ok");
		const [filter, update] = written(m);
		expect(filter).toMatchObject({ paidBy: "u1", version: 0 });
		expect(update.$set.shares).toEqual([S("u1", 1500), S("u2", 1500, 0, { helped: true, helpedAt: NOW })]);
		expect(update.$inc).toEqual({ version: 1 });
		if (r.status === "ok") {
			expect(r.expense.shares.map((s) => [s.uid, s.amountCents, s.helped])).toEqual([["u1", 1500, false], ["u2", 1500, true]]);
			expect(r.expense).toMatchObject({ ownerAlone: false, canHelp: false });
		}
	});
	it("responsável ajuda por uma pessoa sem login que cuida (forUid)", async () => {
		const m = mockDb();
		const r = await helpExpense(m.db, GID, EID, "u2", "m_vo", NOW);
		expect(r.status).toBe("ok");
		expect(written(m)[1].$set.shares).toEqual([S("u1", 1500), S("m_vo", 1500, 0, { helped: true, helpedAt: NOW })]);
	});
	it("forUid inválido: pessoa que não cuida, membro real, ou fora do grupo (422 forUid, sem escrever)", async () => {
		for (const forUid of ["m_ben", "u3", "intruso"]) {
			const m = mockDb();
			expect(await helpExpense(m.db, GID, EID, "u2", forUid)).toMatchObject({ status: "invalid", field: "forUid" });
			expect(m.expenses.updateOne).not.toHaveBeenCalled();
		}
	});
	it("quem pagou não ajuda na própria despesa (nem por ele via forUid)", async () => {
		const m = mockDb();
		expect(await helpExpense(m.db, GID, EID, "u1")).toEqual({ status: "payer" });
		expect(m.expenses.updateOne).not.toHaveBeenCalled();
		// despesa paga pela avó (sem login): o responsável dela também conta como quem pagou
		const vo = mockDb({ expense: aloneExpense({ paidBy: "m_vo", shares: [S("m_vo", 3000)] }) });
		expect(await helpExpense(vo.db, GID, EID, "u2")).toEqual({ status: "payer" });
		expect(await helpExpense(vo.db, GID, EID, "u2", "m_vo")).toEqual({ status: "payer" });
		// mas o responsável pode ajudar por OUTRA pessoa que cuida? m_ben é de u3; u3 ajuda por ele
		expect((await helpExpense(vo.db, GID, EID, "u3", "m_ben", NOW)).status).toBe("ok");
	});
	it("quem já participa: already (com nome para pessoa sem login); cota 0 de reembolso não conta como participar", async () => {
		const both = mockDb({ expense: aloneExpense({ shares: [S("u1", 1500), S("u2", 1500), S("m_vo", 0, 0)] }) });
		expect(await helpExpense(both.db, GID, EID, "u2")).toEqual({ status: "already", name: null });
		const withVo = mockDb({ expense: aloneExpense({ shares: [S("u1", 1500), S("m_vo", 1500)] }) });
		expect(await helpExpense(withVo.db, GID, EID, "u2", "m_vo")).toEqual({ status: "already", name: "Vó" });
		expect(both.expenses.updateOne).not.toHaveBeenCalled();
		const refundOnly = mockDb({ expense: aloneExpense({ shares: [S("u1", 3000), S("u2", 0, 500)] }) });
		expect((await helpExpense(refundOnly.db, GID, EID, "u2", undefined, NOW)).status).toBe("ok");
	});
	it("pagamentos preservados: quem já pagou ganha reembolso quando a cota cai", async () => {
		const m = mockDb({ expense: aloneExpense({ shares: [S("u1", 1500), S("u2", 1500, 1500, { paidAt: NOW, method: "manual" })] }) });
		await helpExpense(m.db, GID, EID, "u3", undefined, NOW);
		const sh = written(m)[1].$set.shares;
		expect(sh.find((s) => s.uid === "u2")).toMatchObject({ amountCents: 1000, paidCents: 1500, paidAt: NOW });
		expect(sh.find((s) => s.uid === "u3")).toMatchObject({ amountCents: 1000, paidCents: 0, helped: true });
	});
	it("não membro: no_group; despesa inexistente ou id ruim: no_expense", async () => {
		expect(await helpExpense(mockDb().db, GID, EID, "intruso")).toEqual({ status: "no_group" });
		expect(await helpExpense(mockDb().db, "ruim", EID, "u2")).toEqual({ status: "no_group" });
		expect(await helpExpense(mockDb({ expense: null }).db, GID, EID, "u2")).toEqual({ status: "no_expense" });
		expect(await helpExpense(mockDb().db, GID, "ruim", "u2")).toEqual({ status: "no_expense" });
	});
	it("valor pequeno demais para mais uma parte: 422 amountCents", async () => {
		const m = mockDb({ expense: aloneExpense({ amountCents: 1, shares: [S("u1", 1)] }) });
		expect(await helpExpense(m.db, GID, EID, "u2")).toMatchObject({ status: "invalid", field: "amountCents" });
	});
	it("conflito de versão: tenta de novo uma vez; depois conflict", async () => {
		const once = mockDb({ matched: [0, 1] });
		expect((await helpExpense(once.db, GID, EID, "u2")).status).toBe("ok");
		expect(once.expenses.updateOne).toHaveBeenCalledTimes(2);
		const twice = mockDb({ matched: [0, 0] });
		expect(await helpExpense(twice.db, GID, EID, "u2")).toEqual({ status: "conflict" });
		expect(twice.expenses.updateOne).toHaveBeenCalledTimes(2);
	});
	it("na nova tentativa a regra roda de novo: se outra pessoa já tinha entrado, already", async () => {
		const m = mockDb({ matched: [0] });
		m.expenses.findOne.mockResolvedValueOnce(aloneExpense()).mockResolvedValueOnce(aloneExpense({ version: 1, shares: [S("u1", 1500), S("u2", 1500)] }));
		expect(await helpExpense(m.db, GID, EID, "u2")).toEqual({ status: "already", name: null });
	});
	it("parcela: só a despesa pedida é tocada (uma escrita)", async () => {
		const m = mockDb({ expense: aloneExpense({ installment: { seriesId: "s", number: 2, count: 3 } }) });
		await helpExpense(m.db, GID, EID, "u2");
		expect(m.expenses.updateOne).toHaveBeenCalledTimes(1);
	});
});

describe("ciclo de vida de helped", () => {
	const helped = [S("u1", 1000), S("u2", 1000, 0, { helped: true, helpedAt: NOW }), S("u3", 1000, 400)];
	it("sai da divisão: a cota some junto com a marca", async () => {
		const sh = recalcShares(helped, "u1", 3000, ["u1", "u3"]);
		expect(sh.find((s) => s.uid === "u2")).toBeUndefined();
	});
	it("sai da divisão mas já pagou: a linha de reembolso fica, sem contar como ajuda", () => {
		const prev = [S("u1", 1000), S("u2", 1000, 1000, { helped: true, helpedAt: NOW })];
		const sh = recalcShares(prev, "u1", 3000, ["u1"]);
		const u2 = sh.find((s) => s.uid === "u2")!;
		expect(u2).toMatchObject({ amountCents: 0, paidCents: 1000 });
		expect(isHelper(u2)).toBe(false);
	});
	it("os outros mantêm a marca ao recalcular e ao quitar/desfazer", async () => {
		const sh = recalcShares(helped, "u1", 3000, ["u1", "u2", "u3", "u2x"]);
		expect(sh.find((s) => s.uid === "u2")).toMatchObject({ helped: true, helpedAt: NOW });
		const undone = undoShare([S("u1", 1000), S("u2", 1000, 1000, { helped: true, helpedAt: NOW, paidAt: NOW, method: "manual" })], "u1", "u2")!;
		expect(undone.shares[1]).toEqual(S("u2", 1000, 0, { helped: true, helpedAt: NOW }));
	});
	it("addHelper marca só a cota nova", () => {
		const sh = addHelper([S("u1", 3000)], "u1", 3000, "u2", NOW);
		expect(sh).toEqual([S("u1", 1500), S("u2", 1500, 0, { helped: true, helpedAt: NOW })]);
	});
	it("updateParticipants removendo o ajudante: sem cota nem marca", async () => {
		const m = mockDb({ expense: aloneExpense({ shares: helped }) });
		await updateParticipants(m.db, GID, EID, "u1", ["u1", "u3"]);
		expect(written(m)[1].$set.shares.map((s) => s.uid)).toEqual(["u1", "u3"]);
	});
	it("quitar mantém a marca", async () => {
		const m = mockDb({ expense: aloneExpense({ shares: helped }) });
		await setSharePaid(m.db, GID, EID, "u1", "u2", "paid", NOW);
		expect(written(m)[1].$set.shares.find((s) => s.uid === "u2")).toMatchObject({ helped: true });
	});
});

describe("canHelp / helpAsUids / helpShareCents / ownerAlone", () => {
	const detail = async (uid: string, expense: unknown = aloneExpense()) => {
		const r = await getExpenseDetail(mockDb({ expense }).db, GID, EID, uid, NOW);
		if (r.status !== "ok") throw new Error(r.status);
		return r.expense;
	};
	it("despesa só do dono: outro membro e responsáveis podem ajudar; o preço é a divisão com +1", async () => {
		expect(await detail("u2")).toMatchObject({ ownerAlone: true, canHelp: true, helpAsUids: ["m_vo"], helpShareCents: 1500 });
		expect(await detail("u3")).toMatchObject({ canHelp: true, helpAsUids: ["m_ben"], helpShareCents: 1500 });
	});
	it("o dono nunca pode ajudar, nem como ele mesmo; só ownerAlone e helpShare nulo", async () => {
		expect(await detail("u1")).toMatchObject({ ownerAlone: true, canHelp: false, helpAsUids: [], helpShareCents: null });
	});
	it("quem já divide não pode ajudar; a divisão com mais gente muda o valor", async () => {
		const e = aloneExpense({ shares: [S("u1", 1000), S("u2", 1000), S("m_vo", 1000)] });
		expect(await detail("u2", e)).toMatchObject({ ownerAlone: false, canHelp: false, helpAsUids: [], helpShareCents: null });
		expect(await detail("u3", e)).toMatchObject({ canHelp: true, helpAsUids: ["m_ben"], helpShareCents: 750 });
	});
	it("quando só a pessoa sem login pode ajudar: canHelp falso, helpAsUids e valor preenchidos", async () => {
		const e = aloneExpense({ shares: [S("u1", 1500), S("u3", 1500)] });
		expect(await detail("u3", e)).toMatchObject({ canHelp: false, helpAsUids: ["m_ben"], helpShareCents: 1000 });
	});
	it("responsável pelo dono sem login não ajuda como ele mesmo, mas ajuda por outra pessoa que cuida", async () => {
		const m = members();
		m.push(managed("m_x", "X", "u2"));
		const e = aloneExpense({ paidBy: "m_vo", shares: [S("m_vo", 3000)] });
		const r = await getExpenseDetail(mockDb({ expense: e, members: m }).db, GID, EID, "u2", NOW);
		expect(r.status === "ok" && r.expense).toMatchObject({ canHelp: false, helpAsUids: ["m_x"] });
	});
	it("valor pequeno demais: ninguém pode ajudar", async () => {
		expect(await detail("u2", aloneExpense({ amountCents: 1, shares: [S("u1", 1)] }))).toMatchObject({ canHelp: false, helpAsUids: [], helpShareCents: null });
	});
	it("quem pagou fora da divisão: a nova parte é a divisão entre os que já dividem + 1", async () => {
		const e = aloneExpense({ shares: [S("u2", 1500), S("u3", 1500)] });
		expect(await detail("u1", e)).toMatchObject({ ownerAlone: false, canHelp: false, helpShareCents: null });
		expect(await detail("u2", e)).toMatchObject({ canHelp: false, helpAsUids: ["m_vo"], helpShareCents: 1000 });
	});
	it("a lista traz canHelp, ownerAlone e helpShareCents", async () => {
		const list = (await listExpenses(mockDb().db, GID, "u2", NOW))!;
		expect(list[0]).toMatchObject({ canHelp: true, ownerAlone: true, helpShareCents: 1500 });
		const mine = (await listExpenses(mockDb().db, GID, "u1", NOW))!;
		expect(mine[0]).toMatchObject({ canHelp: false, ownerAlone: true, helpShareCents: null });
	});
});
