/* eslint-disable @typescript-eslint/no-explicit-any -- filtros do MongoDB no fake em memória */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { AttachmentStore } from "@/lib/storage/attachments";

const { createExpense, deleteExpense, getExpenseDetail, listExpenses, updateParticipants } = await import("./repo");

const GID = "507f1f77bcf86cd799439011";
const NOW = new Date("2026-11-11T15:00:00Z"); // hoje em São Paulo: 2026-11-11
const PIX = { type: "cpf", key: "52998224725" };
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const managed = (uid: string, name: string, managedBy: string) => ({ ...member(uid), kind: "managed" as const, name, managedBy, pixKey: PIX });
// u1 admin; u2 e u3 comuns; m_ben é cuidado por u2
const members = () => [member("u1", "admin"), member("u2"), member("u3"), managed("m_ben", "Benjamim", "u2")];

type Share = { uid: string; amountCents: number; paidCents: number };
const S = (uid: string, amountCents: number, paidCents = 0): Share => ({ uid, amountCents, paidCents });
type Doc = {
	_id: ObjectId;
	groupId: ObjectId;
	createdBy: string;
	paidBy: string;
	description: string;
	amountCents: number;
	date: string;
	pix: Record<string, unknown>;
	shares: Share[];
	version?: number;
	attachments: { id: string; key: string; name: string; contentType: string; size: number }[];
	dueDate?: string;
	installment?: { seriesId: string; number: number; count: number };
	createdAt: Date;
	updatedAt: Date;
};

const addMonths = (d: string, n: number) => {
	const [y, m, day] = d.split("-").map(Number);
	const idx = y * 12 + m - 1 + n;
	return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const KEY = "groups/g/first/" + "a".repeat(32);
const ATT = { id: "a".repeat(32), key: KEY, name: "fatura.pdf", contentType: "application/pdf", size: 10 };

/** Série de `count` parcelas pagas por `paidBy` (padrão u1), dividida entre u1, u2 e u3. */
function seriesDocs(count: number, over: Partial<Doc> = {}, perDoc: (n: number) => Partial<Doc> = () => ({})): Doc[] {
	return Array.from({ length: count }, (_, i) => ({
		_id: new ObjectId(),
		groupId: new ObjectId(GID),
		createdBy: "u1",
		paidBy: "u1",
		description: "Geladeira",
		amountCents: 3000,
		date: "2026-11-10",
		pix: { ...PIX, payeeName: "Ana" },
		shares: [S("u1", 1000), S("u2", 1000), S("u3", 1000)],
		version: 0,
		attachments: [{ ...ATT }],
		dueDate: addMonths("2026-12-10", i),
		installment: { seriesId: "s".repeat(32), number: i + 1, count },
		createdAt: new Date("2026-11-10T10:00:00Z"),
		updatedAt: new Date("2026-11-10T10:00:00Z"),
		...over,
		...perDoc(i + 1),
	}));
}

/** Cópia profunda que preserva ObjectId e Date (structuredClone perderia o protótipo do ObjectId). */
function clone<T>(v: T): T {
	if (v instanceof ObjectId) return new ObjectId(v.toHexString()) as T;
	if (v instanceof Date) return new Date(v.getTime()) as T;
	if (Array.isArray(v)) return v.map(clone) as T;
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
	return v;
}

function fakeDb(o: { docs?: Doc[]; members?: ReturnType<typeof members>; failInsertManyAfter?: number; lose?: Set<string> } = {}) {
	const docs: Doc[] = o.docs ?? [];
	const group = { _id: new ObjectId(GID), name: "Família", members: o.members ?? members() };
	const groups = {
		findOne: vi.fn(async (f: Record<string, unknown>) => (group.members.some((m) => m.uid === f["members.uid"]) ? group : null)),
	};
	const users = {
		findOne: vi.fn().mockResolvedValue({ _id: "u1", name: "Ana", pixKey: PIX }),
		find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
	};
	const matches = (d: Doc, f: Record<string, any>) => {
		if (f._id) {
			const ids: ObjectId[] = f._id.$in ?? [f._id];
			if (!ids.some((i) => i.equals(d._id))) return false;
		}
		if (f.groupId && !f.groupId.equals(d.groupId)) return false;
		if (f["installment.seriesId"] && d.installment?.seriesId !== f["installment.seriesId"]) return false;
		if (f["installment.number"]?.$gte !== undefined && (d.installment?.number ?? 0) < f["installment.number"].$gte) return false;
		if (f["attachments.key"]?.$in && !d.attachments.some((a) => f["attachments.key"].$in.includes(a.key))) return false;
		return true;
	};
	const hasPay = (d: Doc) => d.shares.some((s) => s.uid !== d.paidBy && s.paidCents > 0);
	const cursor = (list: Doc[]) => {
		const c = {
			sort: vi.fn(() => {
				list.sort((a, b) => (a.installment?.number ?? 0) - (b.installment?.number ?? 0));
				return c;
			}),
			toArray: vi.fn(async () => list.map(clone)),
		};
		return c;
	};
	const calls = { updates: [] as { id: string; version: unknown }[] };
	const expenses = {
		findOne: vi.fn(async (f: Record<string, unknown>) => {
			const d = docs.find((x) => matches(x, f));
			return d ? clone(d) : null;
		}),
		find: vi.fn((f: Record<string, unknown>) => cursor(docs.filter((d) => matches(d, f)))),
		aggregate: vi.fn(() => ({ toArray: vi.fn(async () => docs.map(clone)) })),
		insertOne: vi.fn(async (d: Doc) => void docs.push(clone(d))),
		insertMany: vi.fn(async (list: Doc[]) => {
			const stop = o.failInsertManyAfter;
			for (const [i, d] of list.entries()) {
				if (stop !== undefined && i >= stop) throw new Error("insertMany down");
				docs.push(clone(d));
			}
		}),
		updateOne: vi.fn(async (f: Record<string, any>, u: Record<string, any>) => {
			calls.updates.push({ id: f._id.toHexString(), version: f.version });
			const d = docs.find((x) => matches(x, { _id: f._id, groupId: f.groupId }));
			if (!d || o.lose?.has(d._id.toHexString())) return { matchedCount: 0 };
			const okVersion = typeof f.version === "object" ? d.version === undefined : d.version === f.version;
			if (!okVersion) return { matchedCount: 0 };
			Object.assign(d, u.$set);
			d.version = (d.version ?? 0) + (u.$inc?.version ?? 0);
			return { matchedCount: 1 };
		}),
		deleteOne: vi.fn(async (f: Record<string, any>) => {
			const i = docs.findIndex((d) => matches(d, f) && !("shares" in f && hasPay(d)));
			if (i < 0) return { deletedCount: 0 };
			docs.splice(i, 1);
			return { deletedCount: 1 };
		}),
		deleteMany: vi.fn(async (f: Record<string, any>) => {
			let n = 0;
			for (let i = docs.length - 1; i >= 0; i--) {
				if (matches(docs[i], f) && !("shares" in f && hasPay(docs[i]))) {
					docs.splice(i, 1);
					n++;
				}
			}
			return { deletedCount: n };
		}),
	};
	const db = { collection: (n: string) => ({ groups, users, expenses })[n] } as unknown as Db;
	return { db, docs, expenses, users, calls };
}

const fakeStore = () =>
	({ put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) }) satisfies AttachmentStore;
const pdf = { name: "fatura.pdf", contentType: "application/pdf" as const, bytes: new Uint8Array([1, 2, 3]) };
const base = { description: "Geladeira", amountCents: 1000, date: "2026-11-10", participantUids: ["u1", "u2", "u3"] };
const create = (db: Db, store: AttachmentStore, input: Record<string, unknown> = {}, files = [pdf], uid = "u1") =>
	createExpense(db, store, { groupId: GID, uid, input: { ...base, ...input } as never, files, now: NOW });
const id = (d: Doc) => d._id.toHexString();

beforeEach(() => vi.clearAllMocks());

describe("createExpense: vencimento", () => {
	it("compra única com vencimento: insertOne, dueDate gravada, sem série", async () => {
		const { db, expenses, docs } = fakeDb();
		const r = await create(db, fakeStore(), { dueDate: "2026-12-10" }, []);
		expect(r.status).toBe("ok");
		expect(expenses.insertOne).toHaveBeenCalledOnce();
		expect(expenses.insertMany).not.toHaveBeenCalled();
		expect(docs[0]).toMatchObject({ dueDate: "2026-12-10" });
		expect(docs[0]).not.toHaveProperty("installment");
		if (r.status === "ok") expect(r.expense).toMatchObject({ dueDate: "2026-12-10", installment: null, series: null, overdue: false });
	});
	it("sem vencimento: dueDate null e não é gravada", async () => {
		const { db, docs } = fakeDb();
		const r = await create(db, fakeStore(), {}, []);
		expect(docs[0]).not.toHaveProperty("dueDate");
		if (r.status === "ok") expect(r.expense).toMatchObject({ dueDate: null, installment: null, overdue: false });
	});
});

describe("createExpense: parcelas", () => {
	it("3 parcelas num único insertMany, mesmo anexo guardado uma vez e referenciado por todas", async () => {
		const { db, expenses, docs } = fakeDb();
		const store = fakeStore();
		const r = await create(db, store, { installments: { count: 3 }, dueDate: "2026-12-10" });
		expect(expenses.insertMany).toHaveBeenCalledOnce();
		expect(expenses.insertOne).not.toHaveBeenCalled();
		expect(store.put).toHaveBeenCalledOnce();
		expect(docs).toHaveLength(3);
		expect(docs.map((d) => d.dueDate)).toEqual(["2026-12-10", "2027-01-10", "2027-02-10"]);
		expect(docs.map((d) => d.installment?.number)).toEqual([1, 2, 3]);
		expect(new Set(docs.map((d) => d.installment?.seriesId)).size).toBe(1);
		expect(docs[0].installment?.seriesId).toMatch(/^[0-9a-f]{32}$/);
		expect(docs.every((d) => d.installment?.count === 3)).toBe(true);
		// cada parcela é uma despesa do valor informado, dividida e paga à parte
		expect(docs.every((d) => d.amountCents === 1000 && d.paidBy === "u1" && d.version === 0)).toBe(true);
		expect(docs[0].shares.reduce((t, s) => t + s.amountCents, 0)).toBe(1000);
		expect(docs[0].shares.every((s) => s.paidCents === 0)).toBe(true);
		const keys = docs.map((d) => d.attachments.map((a) => a.key));
		expect(keys[0]).toHaveLength(1);
		expect(keys[1]).toEqual(keys[0]);
		expect(keys[2]).toEqual(keys[0]);
		expect(keys[0][0]).toBe(store.put.mock.calls[0][0]);
		expect(docs[0].attachments[0].id).toBe(docs[2].attachments[0].id);
		expect(docs[0].attachments[0].key).toContain(`groups/${GID}/${id(docs[0])}/`);
		// resposta: detalhe da parcela 1 com a série
		expect(r.status).toBe("ok");
		if (r.status === "ok") {
			expect(r.expense.id).toBe(id(docs[0]));
			expect(r.expense).toMatchObject({ dueDate: "2026-12-10", installment: { number: 1, count: 3 } });
			expect(r.expense.series).toEqual({
				count: 3,
				items: docs.map((d, i) => ({ id: id(d), number: i + 1, dueDate: d.dueDate, settled: false, amountCents: d.amountCents })),
			});
		}
	});
	it("31 de janeiro: sempre a partir da primeira data (28/02, 31/03, 30/04)", async () => {
		const { db, docs } = fakeDb();
		await create(db, fakeStore(), { installments: { count: 4 }, dueDate: "2027-01-31" }, []);
		expect(docs.map((d) => d.dueDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
	});
	it("a descrição, a data da compra e o Pix são os mesmos em todas", async () => {
		const { db, docs } = fakeDb();
		await create(db, fakeStore(), { installments: { count: 2 }, dueDate: "2026-12-10" }, []);
		expect(docs[0].description).toBe(docs[1].description);
		expect(docs[0].date).toBe(docs[1].date);
		expect(docs[0].pix).toEqual(docs[1].pix);
		expect(docs[0].pix).toMatchObject({ payeeName: "Ana" });
	});
	it("o valor é o de CADA parcela e precisa ser divisível entre os participantes", async () => {
		const { db, expenses } = fakeDb();
		const store = fakeStore();
		expect(await create(db, store, { installments: { count: 3 }, dueDate: "2026-12-10", amountCents: 2 })).toMatchObject({ status: "invalid", field: "amountCents" });
		expect(store.put).not.toHaveBeenCalled();
		expect(expenses.insertMany).not.toHaveBeenCalled();
	});
	it("insertMany falha no meio: remove as já inseridas, apaga os arquivos e propaga o erro", async () => {
		const { db, docs, expenses } = fakeDb({ failInsertManyAfter: 1 });
		const store = fakeStore();
		await expect(create(db, store, { installments: { count: 3 }, dueDate: "2026-12-10" })).rejects.toThrow("insertMany down");
		expect(docs).toHaveLength(0);
		expect(expenses.deleteMany).toHaveBeenCalledOnce();
		expect(store.delete).toHaveBeenCalledWith([store.put.mock.calls[0][0]]);
	});
	it("upload falha: nada é inserido e os anteriores são apagados", async () => {
		const { db, expenses } = fakeDb();
		const store = fakeStore();
		store.put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("r2"));
		await expect(create(db, store, { installments: { count: 2 }, dueDate: "2026-12-10" }, [pdf, pdf])).rejects.toThrow("r2");
		expect(expenses.insertMany).not.toHaveBeenCalled();
		expect(store.delete).toHaveBeenCalledWith([store.put.mock.calls[0][0]]);
	});
	it("pago por quem o usuário cuida: permitido ao responsável, negado a outro", async () => {
		const ok = fakeDb();
		const r = await create(ok.db, fakeStore(), { installments: { count: 2 }, dueDate: "2026-12-10", paidByUid: "m_ben" }, [], "u2");
		expect(r.status).toBe("ok");
		expect(ok.docs.map((d) => d.paidBy)).toEqual(["m_ben", "m_ben"]);
		const denied = fakeDb();
		const store = fakeStore();
		expect(await create(denied.db, store, { installments: { count: 2 }, dueDate: "2026-12-10", paidByUid: "m_ben" }, [pdf], "u3")).toMatchObject({ status: "invalid", field: "paidByUid" });
		expect(store.put).not.toHaveBeenCalled();
		expect(denied.docs).toHaveLength(0);
	});
});

describe("detalhe e lista: vencimento, atraso e série", () => {
	it("overdue vira à meia-noite de São Paulo (o relógio é injetado)", async () => {
		const [d] = seriesDocs(1, { dueDate: "2026-11-11", installment: undefined });
		const { db } = fakeDb({ docs: [d] });
		const at = async (iso: string) => {
			const r = await getExpenseDetail(db, GID, id(d), "u2", new Date(iso));
			return r.status === "ok" ? r.expense.overdue : null;
		};
		expect(await at("2026-11-12T02:59:59Z")).toBe(false); // 23:59:59 do dia 11 em São Paulo
		expect(await at("2026-11-12T03:00:00Z")).toBe(true); // 00:00:00 do dia 12
		const list = async (iso: string) => (await listExpenses(db, GID, "u2", new Date(iso)))![0].overdue;
		expect(await list("2026-11-12T02:59:59Z")).toBe(false);
		expect(await list("2026-11-12T03:00:00Z")).toBe(true);
	});
	it("não está atrasada quando ninguém deve mais, nem sem vencimento", async () => {
		const paid = seriesDocs(1, { dueDate: "2026-10-01", installment: undefined, shares: [S("u1", 1000), S("u2", 1000, 1000), S("u3", 1000, 1000)] })[0];
		const refundOnly = seriesDocs(1, { dueDate: "2026-10-01", installment: undefined, shares: [S("u1", 1000), S("u2", 500, 900)] })[0]; // só reembolso
		const noDue = seriesDocs(1, { dueDate: undefined, installment: undefined })[0];
		const { db } = fakeDb({ docs: [paid, refundOnly, noDue] });
		for (const d of [paid, refundOnly, noDue]) {
			const r = await getExpenseDetail(db, GID, id(d), "u2", NOW);
			expect(r.status === "ok" && r.expense.overdue).toBe(false);
		}
	});
	it("série no detalhe: só as parcelas que ainda existem, em ordem, com settled", async () => {
		const docs = seriesDocs(3);
		docs[1].shares = [S("u1", 1000), S("u2", 1000, 1000), S("u3", 1000, 1000)]; // parcela 2 quitada
		const { db } = fakeDb({ docs: [docs[2], docs[0], docs[1]].map(clone) }); // fora de ordem
		const r = await getExpenseDetail(db, GID, id(docs[1]), "u2", NOW);
		expect(r.status).toBe("ok");
		if (r.status === "ok") {
			expect(r.expense.installment).toEqual({ seriesId: "s".repeat(32), number: 2, count: 3 });
			expect(r.expense.series?.count).toBe(3);
			expect(r.expense.series?.items.map((i) => [i.number, i.settled])).toEqual([[1, false], [2, true], [3, false]]);
		}
		// parcela 1 apagada: a série mostra só as restantes, count continua o original
		const { db: db2 } = fakeDb({ docs: [clone(docs[1]), clone(docs[2])] });
		const r2 = await getExpenseDetail(db2, GID, id(docs[2]), "u2", NOW);
		if (r2.status === "ok") expect(r2.expense.series).toMatchObject({ count: 3, items: [{ number: 2 }, { number: 3 }] });
	});
	it("lista: dueDate, installment, overdue e settled por item", async () => {
		const open = seriesDocs(1, { dueDate: "2026-11-01", installment: undefined })[0];
		const settled = seriesDocs(1, { dueDate: "2026-11-01", shares: [S("u1", 1000), S("u2", 1000, 1000), S("u3", 1000, 1000)] })[0];
		const refundOpen = seriesDocs(1, { dueDate: undefined, installment: undefined, shares: [S("u1", 1000), S("u2", 500, 900)] })[0];
		const { db } = fakeDb({ docs: [open, settled, refundOpen] });
		const list = (await listExpenses(db, GID, "u2", NOW))!;
		expect(list[0]).toMatchObject({ dueDate: "2026-11-01", installment: null, overdue: true, settled: false });
		expect(list[1]).toMatchObject({ installment: { number: 1, count: 1 }, overdue: false, settled: true });
		expect(list[2]).toMatchObject({ dueDate: null, overdue: false, settled: false }); // reembolso pendente: ainda não quitada
	});
	it("a listagem ordena e limita no banco: em aberto por vencimento, depois quitadas mais novas primeiro, até 300", async () => {
		const { db, expenses } = fakeDb({ docs: [] });
		await listExpenses(db, GID, "u2", NOW);
		const pipeline = (expenses.aggregate.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
		const sort = pipeline.find((st) => "$sort" in st) as { $sort: Record<string, number> };
		expect(sort.$sort).toEqual({ _rank: 1, _asc: 1, date: -1, createdAt: -1, _id: -1 });
		expect(pipeline.find((st) => "$limit" in st)).toEqual({ $limit: 300 });
		const text = JSON.stringify(pipeline);
		expect(text).toContain('"$ifNull":["$dueDate","$date"]'); // sem vencimento vale a data da compra
		expect(text).toContain("$$s.paidCents");
	});
});

describe("apagar: anexos compartilhados", () => {
	it("o objeto só sai do R2 quando a última parcela que o referencia é apagada", async () => {
		const docs = seriesDocs(3);
		const { db } = fakeDb({ docs });
		const store = fakeStore();
		expect(await deleteExpense(db, store, GID, id(docs[2]), "u1")).toEqual({ status: "ok", deleted: 1, kept: 0 });
		expect(store.delete).not.toHaveBeenCalled();
		expect(await deleteExpense(db, store, GID, id(docs[1]), "u1")).toMatchObject({ status: "ok" });
		expect(store.delete).not.toHaveBeenCalled();
		expect(await deleteExpense(db, store, GID, id(docs[0]), "u1")).toMatchObject({ status: "ok" });
		expect(store.delete).toHaveBeenCalledExactlyOnceWith([KEY]);
	});
	it("despesa comum (sem série) apaga o objeto, como antes", async () => {
		const [d] = seriesDocs(1, { installment: undefined, dueDate: undefined });
		const { db } = fakeDb({ docs: [d] });
		const store = fakeStore();
		await deleteExpense(db, store, GID, id(d), "u1");
		expect(store.delete).toHaveBeenCalledWith([KEY]);
	});
	it("outra despesa de chave diferente não segura o objeto; só a mesma chave", async () => {
		const [a] = seriesDocs(1, { installment: undefined });
		const [b] = seriesDocs(1, { installment: undefined, attachments: [{ ...ATT, key: "groups/g/other/" + "b".repeat(32), id: "b".repeat(32) }] });
		const { db } = fakeDb({ docs: [a, b] });
		const store = fakeStore();
		await deleteExpense(db, store, GID, id(a), "u1");
		expect(store.delete).toHaveBeenCalledWith([KEY]);
	});
});

describe("apagar: scope following", () => {
	it("apaga esta e as seguintes sem pagamento; as com pagamento ficam", async () => {
		const docs = seriesDocs(4, {}, (n) => (n === 3 ? { shares: [S("u1", 1000), S("u2", 1000, 1000), S("u3", 1000)] } : {}));
		const { db, docs: live } = fakeDb({ docs });
		const store = fakeStore();
		const r = await deleteExpense(db, store, GID, id(docs[1]), "u1", "following");
		expect(r).toEqual({ status: "ok", deleted: 2, kept: 1 }); // 2 e 4 saem; 3 (com pagamento) fica
		expect(live.map((d) => d.installment?.number)).toEqual([1, 3]);
		expect(store.delete).not.toHaveBeenCalled(); // 1 e 3 ainda referenciam o anexo
	});
	it("o anexo sai quando nenhuma parcela restante o referencia", async () => {
		const docs = seriesDocs(3);
		const { db, docs: live } = fakeDb({ docs });
		const store = fakeStore();
		expect(await deleteExpense(db, store, GID, id(docs[0]), "u1", "following")).toEqual({ status: "ok", deleted: 3, kept: 0 });
		expect(live).toHaveLength(0);
		expect(store.delete).toHaveBeenCalledExactlyOnceWith([KEY]);
	});
	it("parcelas anteriores não são tocadas", async () => {
		const docs = seriesDocs(3);
		const { db, docs: live } = fakeDb({ docs });
		await deleteExpense(db, fakeStore(), GID, id(docs[2]), "u1", "following");
		expect(live.map((d) => d.installment?.number)).toEqual([1, 2]);
	});
	it("a parcela pedida com pagamento: has_payment e nada é apagado", async () => {
		const docs = seriesDocs(3, {}, (n) => (n === 2 ? { shares: [S("u1", 1000), S("u2", 1000, 1000), S("u3", 1000)] } : {}));
		const { db, docs: live, expenses } = fakeDb({ docs });
		expect(await deleteExpense(db, fakeStore(), GID, id(docs[1]), "u1", "following")).toEqual({ status: "has_payment" });
		expect(live).toHaveLength(3);
		expect(expenses.deleteMany).not.toHaveBeenCalled();
	});
	it("scope this numa série apaga só a parcela", async () => {
		const docs = seriesDocs(3);
		const { db, docs: live } = fakeDb({ docs });
		expect(await deleteExpense(db, fakeStore(), GID, id(docs[0]), "u1", "this")).toEqual({ status: "ok", deleted: 1, kept: 0 });
		expect(live).toHaveLength(2);
	});
	it("following numa despesa sem série vale como this", async () => {
		const [d] = seriesDocs(1, { installment: undefined });
		const { db, expenses } = fakeDb({ docs: [d] });
		expect(await deleteExpense(db, fakeStore(), GID, id(d), "u1", "following")).toEqual({ status: "ok", deleted: 1, kept: 0 });
		expect(expenses.deleteOne).toHaveBeenCalledOnce();
	});
	it("permissões: dono, admin e responsável do dono sem login podem; outro membro não", async () => {
		const mk = () => seriesDocs(2, { paidBy: "u2", createdBy: "u2" });
		for (const [uid, expected] of [["u2", "ok"], ["u1", "ok"], ["u3", "forbidden"]] as const) {
			const docs = mk();
			const { db, docs: live } = fakeDb({ docs });
			const r = await deleteExpense(db, fakeStore(), GID, id(docs[0]), uid, "following");
			expect(r.status).toBe(expected);
			expect(live).toHaveLength(expected === "ok" ? 0 : 2);
		}
		// pagas por m_ben: u2 (responsável) apaga, u3 não; admin u1 apaga
		for (const [uid, expected] of [["u2", "ok"], ["u3", "forbidden"], ["u1", "ok"]] as const) {
			const docs = seriesDocs(2, { paidBy: "m_ben", createdBy: "u2" });
			const { db } = fakeDb({ docs });
			expect((await deleteExpense(db, fakeStore(), GID, id(docs[0]), uid, "following")).status).toBe(expected);
		}
	});
	it("não membro e inexistente", async () => {
		const docs = seriesDocs(2);
		expect((await deleteExpense(fakeDb({ docs }).db, fakeStore(), GID, id(docs[0]), "estranho", "following")).status).toBe("no_group");
		expect((await deleteExpense(fakeDb({ docs: [] }).db, fakeStore(), GID, new ObjectId().toHexString(), "u1", "following")).status).toBe("no_expense");
	});
});

describe("participantes: scope following", () => {
	it("aplica a mesma lista a esta parcela e às seguintes, cada uma re-dividida; a pedida vem na resposta", async () => {
		const docs = seriesDocs(3);
		const { db, docs: live } = fakeDb({ docs });
		const r = await updateParticipants(db, GID, id(docs[1]), "u1", ["u1", "u2"], "following", NOW);
		expect(r.status).toBe("ok");
		const by = (n: number) => live.find((d) => d.installment?.number === n)!;
		expect(by(1).shares.map((s) => s.amountCents)).toEqual([1000, 1000, 1000]); // anterior intacta
		expect(by(1).version).toBe(0);
		for (const n of [2, 3]) {
			expect(by(n).version).toBe(1);
			expect(by(n).shares.map((s) => [s.uid, s.amountCents])).toEqual([["u1", 1500], ["u2", 1500]]);
		}
		if (r.status === "ok") {
			expect(r.expense.id).toBe(id(docs[1]));
			expect(r.expense.participantUids).toEqual(["u1", "u2"]);
		}
	});
	it("preserva pagamentos: quem saiu e já pagou numa parcela vira reembolso naquela", async () => {
		const docs = seriesDocs(2, {}, (n) => (n === 2 ? { shares: [S("u1", 1000), S("u2", 1000), S("u3", 1000, 1000)] } : {}));
		const { db, docs: live } = fakeDb({ docs });
		await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "u2"], "following", NOW);
		expect(live[0].shares.map((s) => s.uid)).toEqual(["u1", "u2"]);
		expect(live[1].shares.find((s) => s.uid === "u3")).toEqual({ uid: "u3", amountCents: 0, paidCents: 1000 });
	});
	it("scope this (padrão) mexe só na parcela pedida", async () => {
		const docs = seriesDocs(3);
		const { db, docs: live } = fakeDb({ docs });
		await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "u2"]);
		expect(live.map((d) => d.version)).toEqual([1, 0, 0]);
	});
	it("following numa despesa sem série vale como this", async () => {
		const [d] = seriesDocs(1, { installment: undefined });
		const { db, docs: live } = fakeDb({ docs: [d] });
		expect((await updateParticipants(db, GID, id(d), "u1", ["u1", "u2"], "following", NOW)).status).toBe("ok");
		expect(live[0].version).toBe(1);
	});
	it("valida TODAS antes de escrever: uma parcela indivisível impede qualquer gravação", async () => {
		const docs = seriesDocs(3, {}, (n) => (n === 3 ? { amountCents: 1, shares: [S("u1", 1), S("u2", 0), S("u3", 0)] } : {}));
		const { db, docs: live, expenses } = fakeDb({ docs });
		const r = await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "u2"], "following", NOW);
		expect(r).toMatchObject({ status: "invalid", field: "amountCents" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
		expect(live.map((d) => d.version)).toEqual([0, 0, 0]);
	});
	it("participante fora do grupo e lista vazia: invalid, sem escrita", async () => {
		const docs = seriesDocs(2);
		const { db, expenses } = fakeDb({ docs });
		expect(await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "intruso"], "following", NOW)).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(await updateParticipants(db, GID, id(docs[0]), "u1", [], "following", NOW)).toMatchObject({ status: "invalid", field: "participantUids" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
	});
	it("conflito numa parcela depois de gravar outras: desfaz as gravadas e responde conflict", async () => {
		const docs = seriesDocs(3);
		const original = clone(docs);
		const { db, docs: live, calls } = fakeDb({ docs, lose: new Set([id(docs[2])]) });
		const r = await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "u2"], "following", NOW);
		expect(r).toEqual({ status: "conflict" });
		// parcelas 1 e 2 foram gravadas e depois restauradas (versão sobe, cotas voltam)
		for (const n of [0, 1]) {
			expect(live[n].shares).toEqual(original[n].shares);
			expect(live[n].version).toBe(2);
		}
		expect(live[2].version).toBe(0);
		expect(calls.updates.filter((u) => u.id === id(docs[2]))).toHaveLength(2); // uma nova tentativa antes de desistir
	});
	it("conflito na primeira parcela: nada foi gravado, nada a desfazer", async () => {
		const docs = seriesDocs(2);
		const { db, docs: live } = fakeDb({ docs, lose: new Set([id(docs[0])]) });
		expect(await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "u2"], "following", NOW)).toEqual({ status: "conflict" });
		expect(live.map((d) => d.version)).toEqual([0, 0]);
	});
	it("se alguém mexeu na parcela gravada, o desfazer não sobrescreve a mudança dele", async () => {
		const docs = seriesDocs(2);
		const { db, docs: live, expenses } = fakeDb({ docs, lose: new Set([id(docs[1])]) });
		// simula escrita concorrente na parcela 1 logo após a gravação: sobe a versão antes do desfazer
		const real = expenses.updateOne.getMockImplementation()!;
		let n = 0;
		expenses.updateOne.mockImplementation(async (f, u) => {
			const res = await real(f, u);
			if (++n === 1) live[0].version = (live[0].version ?? 0) + 1;
			return res;
		});
		const r = await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "u2"], "following", NOW);
		expect(r).toEqual({ status: "conflict" });
		expect(live[0].shares.map((s) => s.uid)).toEqual(["u1", "u2"]); // mudança do outro (versão) preservada, não revertida
	});
	it("permissões: dono e responsável do dono sem login podem; outros não", async () => {
		for (const [uid, expected] of [["u1", "ok"], ["u2", "forbidden"], ["u3", "forbidden"]] as const) {
			const docs = seriesDocs(2);
			const { db, expenses } = fakeDb({ docs });
			expect((await updateParticipants(db, GID, id(docs[0]), uid, ["u1", "u2"], "following", NOW)).status).toBe(expected);
			if (expected === "forbidden") expect(expenses.updateOne).not.toHaveBeenCalled();
		}
		for (const [uid, expected] of [["u2", "ok"], ["u3", "forbidden"], ["u1", "ok"]] as const) {
			const docs = seriesDocs(2, { paidBy: "m_ben", createdBy: "u2", shares: [S("m_ben", 1000), S("u1", 1000), S("u2", 1000)] });
			const { db } = fakeDb({ docs });
			expect((await updateParticipants(db, GID, id(docs[0]), uid, ["m_ben", "u1"], "following", NOW)).status).toBe(expected);
		}
	});
	it("não membro e inexistente", async () => {
		const docs = seriesDocs(2);
		expect((await updateParticipants(fakeDb({ docs }).db, GID, id(docs[0]), "estranho", ["u1"], "following")).status).toBe("no_group");
		expect((await updateParticipants(fakeDb({ docs: [] }).db, GID, new ObjectId().toHexString(), "u1", ["u1"], "following")).status).toBe("no_expense");
	});
});

describe("createExpense: cashback", () => {
	const sumShares = (d: Doc) => d.shares.reduce((t, s) => t + s.amountCents, 0);
	const cbOf = (d: Doc) => (d as Doc & { cashbackCents?: number }).cashbackCents;

	it("à vista: grava o líquido, o cashback, e as partes somam o líquido", async () => {
		const { db, docs } = fakeDb();
		const r = await create(db, fakeStore(), { amountCents: 100_000, cashback: { cents: 5_000 } }, []);
		expect(docs).toHaveLength(1);
		expect(docs[0].amountCents).toBe(95_000);
		expect(cbOf(docs[0])).toBe(5_000);
		expect(sumShares(docs[0])).toBe(95_000);
		expect(r.status === "ok" && r.expense).toMatchObject({ amountCents: 95_000, cashbackCents: 5_000 });
		expect(r.status === "ok" && r.newExpense).toMatchObject({ amountCents: 95_000 });
	});
	it("sem cashback: o campo não é gravado e o detalhe devolve 0", async () => {
		const { db, docs } = fakeDb();
		const r = await create(db, fakeStore(), {}, []);
		expect(docs[0]).not.toHaveProperty("cashbackCents");
		expect(r.status === "ok" && r.expense.cashbackCents).toBe(0);
	});
	it("parcelado, dividido: cada parcela divide o seu líquido e a soma do cashback é o total", async () => {
		const { db, docs } = fakeDb();
		const r = await create(db, fakeStore(), { amountCents: 10_000, installments: { count: 3 }, dueDate: "2026-12-10", cashback: { cents: 1_000, mode: "spread" } }, []);
		expect(docs.map((d) => cbOf(d))).toEqual([334, 333, 333]);
		expect(docs.map((d) => d.amountCents)).toEqual([9_666, 9_667, 9_667]);
		for (const d of docs) expect(sumShares(d)).toBe(d.amountCents);
		expect(docs.reduce((t, d) => t + (cbOf(d) ?? 0), 0)).toBe(1_000);
		expect(r.status === "ok" && r.newExpense).toMatchObject({ amountCents: 9_666, installments: 3, installmentsDiffer: true });
		if (r.status === "ok") expect(r.expense.series?.items.map((i) => i.amountCents)).toEqual([9_666, 9_667, 9_667]);
	});
	it("parcelado, tudo na primeira: só a primeira tem cashback", async () => {
		const { db, docs } = fakeDb();
		await create(db, fakeStore(), { amountCents: 10_000, installments: { count: 3 }, dueDate: "2026-12-10", cashback: { cents: 1_500, mode: "first" } }, []);
		expect(docs.map((d) => d.amountCents)).toEqual([8_500, 10_000, 10_000]);
		expect(cbOf(docs[0])).toBe(1_500);
		expect(docs[1]).not.toHaveProperty("cashbackCents");
		expect(docs[2]).not.toHaveProperty("cashbackCents");
		for (const d of docs) expect(sumShares(d)).toBe(d.amountCents);
	});
	it("parcelas iguais (cashback divisível): o aviso não diz que diferem", async () => {
		const { db } = fakeDb();
		const r = await create(db, fakeStore(), { amountCents: 10_000, installments: { count: 2 }, dueDate: "2026-12-10", cashback: { cents: 1_000 } }, []);
		expect(r.status === "ok" && r.newExpense).not.toHaveProperty("installmentsDiffer");
	});
	it("cashback maior que a primeira parcela: erro claro, sem upload nem gravação", async () => {
		const { db, expenses } = fakeDb();
		const store = fakeStore();
		const r = await create(db, store, { amountCents: 10_000, installments: { count: 3 }, dueDate: "2026-12-10", cashback: { cents: 10_000, mode: "first" } });
		expect(r).toEqual({ status: "invalid", field: "cashback", error: "O cashback é maior que a primeira parcela. Escolha dividir entre as parcelas." });
		expect(store.put).not.toHaveBeenCalled();
		expect(expenses.insertMany).not.toHaveBeenCalled();
		expect(expenses.insertOne).not.toHaveBeenCalled();
	});
	it("à vista com cashback igual à compra: recusa", async () => {
		const { db } = fakeDb();
		const store = fakeStore();
		expect(await create(db, store, { amountCents: 5_000, cashback: { cents: 5_000 } })).toMatchObject({ status: "invalid", field: "cashback", error: "O cashback precisa ser menor que o valor da compra." });
		expect(store.put).not.toHaveBeenCalled();
	});
	it("líquido pequeno demais para dividir entre todos: erro no valor, sem estado parcial", async () => {
		const { db, expenses } = fakeDb();
		const store = fakeStore();
		expect(await create(db, store, { amountCents: 10, cashback: { cents: 8 } })).toMatchObject({ status: "invalid", field: "amountCents" });
		expect(store.put).not.toHaveBeenCalled();
		expect(expenses.insertOne).not.toHaveBeenCalled();
	});
});

describe("parcelas com valores diferentes (cashback)", () => {
	it("mudar quem divide nas seguintes refaz cada parcela pelo seu valor e mantém o cashback", async () => {
		const docs = seriesDocs(3, {}, (n) => (n === 1 ? ({ amountCents: 2000, cashbackCents: 1000, shares: [S("u1", 668), S("u2", 666), S("u3", 666)] } as Partial<Doc>) : {}));
		const { db } = fakeDb({ docs });
		const r = await updateParticipants(db, GID, id(docs[0]), "u1", ["u1", "u2"], "following", NOW);
		expect(r.status).toBe("ok");
		expect(docs.map((d) => d.shares.reduce((t, s) => t + s.amountCents, 0))).toEqual([2000, 3000, 3000]);
		expect((docs[0] as Doc & { cashbackCents?: number }).cashbackCents).toBe(1000);
		expect(docs[1]).not.toHaveProperty("cashbackCents");
	});
});
