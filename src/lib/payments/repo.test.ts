import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ExpenseDoc } from "@/lib/expenses/repo";
import { releaseReceipts } from "@/lib/expenses/repo";
import type { AttachmentStore } from "@/lib/storage/attachments";
import { itemId, payBatch, validateBatch } from "./repo";

const G1 = new ObjectId("507f1f77bcf86cd799439011");
const G2 = new ObjectId("507f1f77bcf86cd799439012");
const E1 = new ObjectId("607f1f77bcf86cd799439001");
const E2 = new ObjectId("607f1f77bcf86cd799439002");
const E3 = new ObjectId("607f1f77bcf86cd799439003");
const m = (uid: string, extra: Record<string, unknown> = {}) => ({ uid, role: "member" as const, joinedAt: new Date(), ...extra });
const GROUPS = [
	{ _id: G1, name: "Casa", members: [m("me"), m("ana"), m("m_ben", { kind: "managed", managedBy: "me" })] },
	{ _id: G2, name: "Viagem", members: [m("me"), m("ana")] },
];
const mk = (_id: ObjectId, groupId: ObjectId, over: Record<string, unknown> = {}) =>
	({
		_id,
		groupId,
		createdBy: "ana",
		paidBy: "ana",
		description: "Item",
		amountCents: 2000,
		date: "2026-11-01",
		pix: { type: "email", key: "ana@x.com", payeeName: "Ana" },
		shares: [
			{ uid: "ana", amountCents: 1000, paidCents: 0 },
			{ uid: "me", amountCents: 1000, paidCents: 0 },
			{ uid: "m_ben", amountCents: 500, paidCents: 0 },
		],
		version: 0,
		attachments: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		...over,
	}) as unknown as ExpenseDoc;

const copy = (d: ExpenseDoc): ExpenseDoc => ({ ...d, shares: d.shares.map((x) => ({ ...x, ...(x.receipt ? { receipt: { ...x.receipt } } : {}), ...(x.batch ? { batch: { ...x.batch } } : {}) })) });

/** Banco em memória mínimo: groups.find, expenses.findOne/find/updateOne com checagem de versão. */
function fakeDb(docs: ExpenseDoc[], opts: { failOn?: ObjectId; throwOn?: ObjectId } = {}) {
	const state = new Map(docs.map((d) => [d._id.toHexString(), copy(d)]));
	const expenses = {
		findOne: vi.fn(async (f: { _id: ObjectId; groupId?: ObjectId }) => {
			const d = state.get(f._id.toHexString());
			return d && (!f.groupId || f.groupId.equals(d.groupId)) ? copy(d) : null;
		}),
		find: vi.fn((f: Record<string, { $in?: string[] }>) => ({
			toArray: async () => {
				const keys = f["shares.receipt.key"]?.$in ?? (f as unknown as { $or: Record<string, { $in: string[] }>[] }).$or?.[0]?.["shares.receipt.key"]?.$in ?? [];
				return [...state.values()].filter((d) => d.shares.some((s) => s.receipt && keys.includes(s.receipt.key))).map((d) => copy(d));
			},
		})),
		updateOne: vi.fn(async (f: { _id: ObjectId; version?: number }, u: { $set: Record<string, unknown> }) => {
			if (opts.throwOn?.equals(f._id)) throw new Error("boom");
			const d = state.get(f._id.toHexString());
			if (!d || opts.failOn?.equals(f._id) || (d.version ?? 0) !== f.version) return { matchedCount: 0 };
			state.set(f._id.toHexString(), { ...d, ...u.$set, version: (d.version ?? 0) + 1 } as ExpenseDoc);
			return { matchedCount: 1 };
		}),
	};
	const groups = {
		find: vi.fn((f: { _id: { $in: ObjectId[] }; "members.uid": string }) => ({
			toArray: async () => GROUPS.filter((g) => f._id.$in.some((id) => id.equals(g._id)) && g.members.some((x) => x.uid === f["members.uid"])),
		})),
	};
	const users = { find: vi.fn(() => ({ toArray: async () => [] })) };
	const db = { collection: (n: string) => (n === "expenses" ? expenses : n === "users" ? users : groups) } as unknown as Db;
	return { db, state, expenses, get: (id: ObjectId) => state.get(id.toHexString())! };
}
const fakeStore = () =>
	({ put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) }) satisfies AttachmentStore;
const PNG = { name: "pix.png", contentType: "image/png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]) };
const it1 = (g: ObjectId, e: ObjectId, shareUid = "me") => ({ groupId: g.toHexString(), expenseId: e.toHexString(), shareUid });
const base = () => [mk(E1, G1), mk(E2, G2), mk(E3, G1, { pix: { type: "email", key: "outra@x.com", payeeName: "Ana" } })];

beforeEach(() => vi.clearAllMocks());

describe("validateBatch", () => {
	it("soma o que falta pagar; aceita cota própria e de quem cuida na mesma despesa", async () => {
		const { db } = fakeDb(base());
		expect(await validateBatch(db, "me", [it1(G1, E1), it1(G1, E1, "m_ben"), it1(G2, E2)])).toEqual({ status: "ok", totalCents: 2500 });
	});
	it("recusa destinatários diferentes (mesma pessoa com outra chave Pix) sem mudar nada", async () => {
		const { db, expenses } = fakeDb(base());
		expect(await validateBatch(db, "me", [it1(G1, E1), it1(G1, E3)])).toEqual({ status: "invalid", error: "Essas contas são de destinatários ou chaves Pix diferentes. Pague cada cartão separado.", field: "items" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
	});
	it("recusa pagador diferente com mesma chave", async () => {
		const other = mk(E3, G1, { paidBy: "me", shares: [{ uid: "me", amountCents: 0, paidCents: 0 }, { uid: "ana", amountCents: 100, paidCents: 0 }] });
		const { db } = fakeDb([mk(E1, G1), other]);
		expect((await validateBatch(db, "me", [it1(G1, E1), it1(G1, E3, "ana")])).status).toBe("forbidden"); // não age por "ana"
	});
	it("404 grupo fora, despesa inexistente, cota inexistente; 403 de outra pessoa; 422 já paga, repetidos e vazio", async () => {
		const { db } = fakeDb(base());
		expect((await validateBatch(db, "zé", [it1(G1, E1)])).status).toBe("no_group");
		expect((await validateBatch(db, "me", [it1(G1, new ObjectId())])).status).toBe("no_expense");
		expect((await validateBatch(db, "me", [it1(G1, E1, "ana")])).status).toBe("forbidden");
		expect((await validateBatch(db, "me", [it1(G1, E1, "m_nada")])).status).toBe("forbidden");
		expect((await validateBatch(db, "me", [{ ...it1(G2, E2), expenseId: E1.toHexString() }])).status).toBe("no_expense");
		const paid = fakeDb([mk(E1, G1, { shares: [{ uid: "ana", amountCents: 1000, paidCents: 0 }, { uid: "me", amountCents: 1000, paidCents: 1000 }] })]);
		expect((await validateBatch(paid.db, "me", [it1(G1, E1)])).status).toBe("invalid");
		expect((await validateBatch(db, "me", [it1(G1, E1), it1(G1, E1)])).status).toBe("invalid");
		expect((await validateBatch(db, "me", [])).status).toBe("invalid");
		expect((await validateBatch(db, "me", Array.from({ length: 51 }, (_, i) => it1(G1, E1, `u${i}`)))).status).toBe("invalid");
		expect((await validateBatch(db, "me", [{ groupId: "x", expenseId: "y", shareUid: "me" }])).status).toBe("invalid");
	});
});

describe("payBatch", () => {
	it("sobe o comprovante uma vez e quita tudo com a mesma chave e o mesmo lote; despesa com 2 cotas grava uma vez", async () => {
		const { db, get, expenses } = fakeDb(base());
		const store = fakeStore();
		const r = await payBatch(db, store, { uid: "me", items: [it1(G1, E1), it1(G1, E1, "m_ben"), it1(G2, E2)], file: PNG });
		if (r.status !== "ok") throw new Error(r.status);
		expect(store.put).toHaveBeenCalledTimes(1);
		const key = store.put.mock.calls[0][0] as string;
		expect(key.startsWith(`receipts/batch/${r.batchId}/`)).toBe(true);
		expect(r.paid).toEqual([
			{ ...it1(G1, E1), amountCents: 1000 },
			{ ...it1(G1, E1, "m_ben"), amountCents: 500 },
			{ ...it1(G2, E2), amountCents: 1000 },
		]);
		expect(r.failed).toEqual([]);
		expect(r.totalPaidCents).toBe(2500);
		expect(r.hasReceipt).toBe(true);
		expect(expenses.updateOne).toHaveBeenCalledTimes(2);
		const paid = [get(E1).shares[1], get(E1).shares[2], get(E2).shares[1]];
		for (const s of paid) {
			expect(s).toMatchObject({ method: "self", markedBy: "me", paidCents: s.amountCents, receipt: { key }, batch: { id: r.batchId, totalCents: 2500, count: 3 } });
			expect(s.paidAt).toBeInstanceOf(Date);
		}
		expect(get(E1).shares[0]).toEqual({ uid: "ana", amountCents: 1000, paidCents: 0 });
		expect(store.delete).not.toHaveBeenCalled();
	});
	it("sem arquivo: sem upload, hasReceipt false, lote gravado", async () => {
		const { db, get } = fakeDb(base());
		const store = fakeStore();
		const r = await payBatch(db, store, { uid: "me", items: [it1(G1, E1)] });
		expect(r).toMatchObject({ status: "ok", hasReceipt: false });
		expect(store.put).not.toHaveBeenCalled();
		expect(get(E1).shares[1]).toMatchObject({ method: "self", batch: { totalCents: 1000, count: 1 } });
		expect(get(E1).shares[1]).not.toHaveProperty("receipt");
	});
	it("falha parcial: conflito numa despesa não impede as outras; totais do lote refletem o que foi pago", async () => {
		const { db, get } = fakeDb(base(), { failOn: E2 });
		const store = fakeStore();
		const r = await payBatch(db, store, { uid: "me", items: [it1(G1, E1), it1(G1, E1, "m_ben"), it1(G2, E2)], file: PNG });
		if (r.status !== "ok") throw new Error(r.status);
		expect(r.paid.map((p) => p.shareUid)).toEqual(["me", "m_ben"]);
		expect(r.failed).toEqual([{ ...it1(G2, E2), reason: "conflict" }]);
		expect(r.totalPaidCents).toBe(1500);
		expect(get(E1).shares[1].batch).toEqual({ id: r.batchId, totalCents: 1500, count: 2 });
		expect(get(E1).shares[2].batch).toEqual({ id: r.batchId, totalCents: 1500, count: 2 });
		expect(get(E2).shares[1]).toEqual({ uid: "me", amountCents: 1000, paidCents: 0 });
		expect(store.delete).not.toHaveBeenCalled(); // o objeto continua referenciado
	});
	it("cota paga no meio do caminho vira already_paid; despesa apagada, not_found", async () => {
		const f = fakeDb(base());
		const realFind = f.expenses.findOne.getMockImplementation()!;
		let calls = 0;
		// a validação lê o estado antigo; depois a despesa E2 é paga por fora e E1 some
		f.expenses.findOne.mockImplementation(async (q: { _id: ObjectId }) => {
			calls++;
			if (calls === 3) {
				f.state.get(E2.toHexString())!.shares[1] = { uid: "me", amountCents: 1000, paidCents: 1000 };
				f.state.delete(E1.toHexString());
			}
			return realFind(q);
		});
		const store = fakeStore();
		const r = await payBatch(f.db, store, { uid: "me", items: [it1(G1, E1), it1(G2, E2)], file: PNG });
		expect(r).toEqual({ status: "all_failed" });
		expect(store.put).toHaveBeenCalledTimes(1);
		expect(store.delete).toHaveBeenCalledWith([store.put.mock.calls[0][0]]);
	});
	it("already_paid e not_found aparecem em failed quando outra cota foi paga", async () => {
		const f = fakeDb(base());
		const realFind = f.expenses.findOne.getMockImplementation()!;
		let calls = 0;
		f.expenses.findOne.mockImplementation(async (q: { _id: ObjectId }) => {
			calls++;
			if (calls === 4) {
				f.state.get(E2.toHexString())!.shares[1] = { uid: "me", amountCents: 1000, paidCents: 1000 };
				f.state.delete(E3.toHexString());
			}
			return realFind(q);
		});
		const r = await payBatch(f.db, fakeStore(), {
			uid: "me",
			items: [it1(G1, E1), it1(G2, E2), it1(G1, E3)],
		}).catch((e) => e);
		// E3 tem outra chave Pix: a validação recusa antes de qualquer gravação
		expect(r).toMatchObject({ status: "invalid" });
		const f2 = fakeDb([mk(E1, G1), mk(E2, G2), mk(E3, G1)]);
		const real2 = f2.expenses.findOne.getMockImplementation()!;
		let n = 0;
		f2.expenses.findOne.mockImplementation(async (q: { _id: ObjectId }) => {
			n++;
			if (n === 4) {
				f2.state.get(E2.toHexString())!.shares[1] = { uid: "me", amountCents: 1000, paidCents: 1000 };
				f2.state.delete(E3.toHexString());
			}
			return real2(q);
		});
		const ok = await payBatch(f2.db, fakeStore(), { uid: "me", items: [it1(G1, E1), it1(G2, E2), it1(G1, E3)] });
		if (ok.status !== "ok") throw new Error(ok.status);
		expect(ok.paid.map((p) => p.expenseId)).toEqual([E1.toHexString()]);
		expect(ok.failed).toEqual([
			{ ...it1(G2, E2), reason: "already_paid" },
			{ ...it1(G1, E3), reason: "not_found" },
		]);
	});
	it("erro do banco no meio: apaga o objeto se nenhuma cota o referencia e propaga", async () => {
		const { db } = fakeDb(base(), { throwOn: E1 });
		const store = fakeStore();
		await expect(payBatch(db, store, { uid: "me", items: [it1(G1, E1)], file: PNG })).rejects.toThrow("boom");
		expect(store.delete).toHaveBeenCalledWith([store.put.mock.calls[0][0]]);
	});
	it("pedido inválido não sobe arquivo nem grava", async () => {
		const { db, expenses } = fakeDb(base());
		const store = fakeStore();
		expect((await payBatch(db, store, { uid: "me", items: [it1(G1, E1), it1(G1, E3)], file: PNG })).status).toBe("invalid");
		expect(store.put).not.toHaveBeenCalled();
		expect(expenses.updateOne).not.toHaveBeenCalled();
	});
});

describe("releaseReceipts (objeto compartilhado)", () => {
	const withReceipt = (e: ObjectId, g: ObjectId, uids: string[]) =>
		mk(e, g, {
			shares: [{ uid: "ana", amountCents: 1000, paidCents: 0 }, ...uids.map((uid) => ({ uid, amountCents: 100, paidCents: 100, receipt: { id: "r", key: "receipts/batch/b/r", name: "p", contentType: "image/png", size: 1 } }))],
		});
	it("só apaga quando nenhuma cota de nenhuma despesa referencia a chave", async () => {
		const f = fakeDb([withReceipt(E1, G1, ["me"]), withReceipt(E2, G2, ["me"])]);
		const store = fakeStore();
		await releaseReceipts(f.db, store, ["receipts/batch/b/r"]);
		expect(store.delete).not.toHaveBeenCalled();
		f.state.delete(E1.toHexString());
		await releaseReceipts(f.db, store, ["receipts/batch/b/r"]);
		expect(store.delete).not.toHaveBeenCalled();
		f.state.delete(E2.toHexString());
		await releaseReceipts(f.db, store, ["receipts/batch/b/r", "receipts/batch/b/r"]);
		expect(store.delete).toHaveBeenCalledWith(["receipts/batch/b/r"]);
	});
});

describe("identidade das contas do lote (parte x devolução)", () => {
	const base = { groupId: G1.toHexString(), expenseId: E1.toHexString(), shareUid: "me" };
	it("o tipo faz parte da identidade: mesma despesa e pessoa, tipos diferentes, não colidem", () => {
		expect(itemId(base)).not.toBe(itemId({ ...base, kind: "refund" }));
		expect(itemId(base)).toBe(itemId({ ...base, kind: "share" }));
	});
	it("uma parte e uma devolução da mesma despesa e pessoa não são 'repetidas' na validação", async () => {
		const { db } = fakeDb([mk(E1, G1)]);
		const r = await validateBatch(db, "me", [base, { ...base, kind: "refund" }]);
		expect(r).not.toEqual({ status: "invalid", error: "Escolha de 1 a 50 contas, sem repetir.", field: "items" });
		expect((await validateBatch(db, "me", [{ ...base, kind: "refund" }, { ...base, kind: "refund" }])).status).toBe("invalid"); // repetida de verdade
	});
});
