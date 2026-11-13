/* eslint-disable @typescript-eslint/no-explicit-any -- filtros do MongoDB no fake em memória */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { setSharePaid, type ExpenseDoc } from "@/lib/expenses/repo";
import { checkShareInvariant, dueCents, receiptKeysOfShare, type ExpenseShare } from "@/lib/expenses/shares";
import type { AttachmentStore } from "@/lib/storage/attachments";
import { advanceInstallments, getAdvancePlan, WRITE_CONCURRENCY } from "./advance-repo";
import { recipientIdFromKey, recipientKey } from "./payables";

const GID = "507f1f77bcf86cd799439011";
const NOW = new Date("2026-11-13T15:00:00Z");
const PIX = { type: "cpf" as const, key: "52998224725", payeeName: "Ana" };
const OTHER_PIX = { type: "email" as const, key: "outra@x.com", payeeName: "Ana" };
const member = (uid: string, role: "admin" | "member" = "member", extra: Record<string, unknown> = {}) => ({ uid, role, joinedAt: new Date(), ...extra });
const MEMBERS = () => [member("adm", "admin"), member("u1"), member("u2"), member("u3"), member("m_ben", "member", { kind: "managed", name: "Benjamim", managedBy: "u2", pixKey: PIX })];
const SERIES = "s".repeat(32);

type Doc = ExpenseDoc;
const share = (uid: string, amountCents: number, paidCents = 0): ExpenseShare => ({ uid, amountCents, paidCents });
/** Parcelas pagas por u1; `due` = o que cada pessoa divide em cada parcela (u2 e m_ben por padrão). */
function series(count: number, amountOf: (n: number) => number = () => 10000, over: (n: number) => Partial<Doc> = () => ({})): Doc[] {
	return Array.from({ length: count }, (_, i) => ({
		_id: new ObjectId(),
		groupId: new ObjectId(GID),
		createdBy: "u1",
		paidBy: "u1",
		description: "Sofá",
		amountCents: amountOf(i + 1) * 2,
		date: "2026-11-01",
		pix: { ...PIX },
		shares: [share("u1", amountOf(i + 1)), share("u2", amountOf(i + 1)), share("m_ben", 0)],
		version: 0,
		attachments: [],
		dueDate: `2026-${String(12 + i > 12 ? ((11 + i) % 12) + 1 : 12 + i).padStart(2, "0")}-10`,
		installment: { seriesId: SERIES, number: i + 1, count },
		createdAt: new Date(),
		updatedAt: new Date(),
		...over(i + 1),
	})) as unknown as Doc[];
}

function clone<T>(v: T): T {
	if (v instanceof ObjectId) return new ObjectId(v.toHexString()) as T;
	if (v instanceof Date) return new Date(v.getTime()) as T;
	if (Array.isArray(v)) return v.map(clone) as T;
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
	return v;
}

function fakeDb(docs: Doc[], o: { lose?: Set<string>; throwOn?: string; failRelease?: boolean; members?: ReturnType<typeof MEMBERS> } = {}) {
	const group = { _id: new ObjectId(GID), name: "Família", members: o.members ?? MEMBERS() };
	const keysOf = (s: ExpenseShare) => receiptKeysOfShare(s);
	const matches = (d: Doc, f: Record<string, any>) => {
		if (f._id && !f._id.equals(d._id)) return false;
		if (f.groupId && !f.groupId.equals(d.groupId)) return false;
		if (f["installment.seriesId"] && d.installment?.seriesId !== f["installment.seriesId"]) return false;
		if (f["installment.number"]?.$gte !== undefined && (d.installment?.number ?? 0) < f["installment.number"].$gte) return false;
		if (f.$or) {
			const keys = new Set<string>(f.$or.flatMap((c: Record<string, { $in: string[] }>) => Object.values(c).flatMap((v) => v.$in)));
			if (!d.shares.some((s) => keysOf(s).some((k) => keys.has(k)))) return false;
		}
		return true;
	};
	const calls = { updates: [] as { id: string; version: unknown }[] };
	const expenses = {
		findOne: vi.fn(async (f: Record<string, any>) => {
			const d = docs.find((x) => matches(x, f));
			return d ? clone(d) : null;
		}),
		find: vi.fn((f: Record<string, any>) => {
			if (o.failRelease && f.$or) throw new Error("find caiu");
			const list = docs.filter((d) => matches(d, f));
			const c = {
				sort: vi.fn(() => {
					list.sort((a, b) => (a.installment?.number ?? 0) - (b.installment?.number ?? 0));
					return c;
				}),
				toArray: vi.fn(async () => list.map(clone)),
			};
			return c;
		}),
		updateOne: vi.fn(async (f: Record<string, any>, u: Record<string, any>) => {
			calls.updates.push({ id: f._id.toHexString(), version: f.version });
			if (o.throwOn === f._id.toHexString()) throw new Error("boom");
			const d = docs.find((x) => matches(x, { _id: f._id, groupId: f.groupId }));
			if (!d || o.lose?.has(d._id.toHexString())) return { matchedCount: 0 };
			const okVersion = typeof f.version === "object" ? d.version === undefined : d.version === f.version;
			if (!okVersion) return { matchedCount: 0 };
			Object.assign(d, u.$set);
			d.version = (d.version ?? 0) + (u.$inc?.version ?? 0);
			return { matchedCount: 1 };
		}),
	};
	const groups = { findOne: vi.fn(async (f: Record<string, unknown>) => (group.members.some((m) => m.uid === f["members.uid"]) ? group : null)) };
	const users = { findOne: vi.fn().mockResolvedValue(null), find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) };
	const plans = { findOne: vi.fn().mockResolvedValue(null) };
	const db = { collection: (n: string) => ({ groups, users, expenses, plans })[n] } as unknown as Db;
	return { db, docs, expenses, calls };
}

const store = () => ({ put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) }) satisfies AttachmentStore;
const pdf = { name: "comprovante.pdf", contentType: "application/pdf" as const, bytes: new Uint8Array([1, 2, 3]) };
const id = (d: Doc) => d._id.toHexString();
const shareOf = (d: Doc, uid = "u2") => d.shares.find((s) => s.uid === uid)!;
const total = (docs: Doc[], who = "u2") => docs.reduce((t, d) => t + (d.shares.some((s) => s.uid === who) ? dueCents(shareOf(d, who), d.paidBy) : 0), 0);
/** O id de quem recebe como a tela o vê: pagando (`self`) = quem pagou + chave Pix; recebendo (`manual`) = só quem pagou. */
const rid = (mode: "self" | "manual", paidBy = "u1", pix: { type: "cpf" | "email"; key: string } = PIX) => recipientIdFromKey(mode === "self" ? recipientKey({ paidBy, pix })! : paidBy);
const adv = (db: Db, st: AttachmentStore, docs: Doc[], over: Partial<Parameters<typeof advanceInstallments>[2]> = {}) =>
	advanceInstallments(db, st, { groupId: GID, eid: id(docs[0]), uid: "u2", shareUid: "u2", mode: "self", amountCents: 34700, expectedDueCents: total(docs), recipientId: rid(over.mode ?? "self"), now: NOW, ...over });

beforeEach(() => vi.clearAllMocks());

describe("advanceInstallments: o exemplo do dono", () => {
	it("R$ 347 em 10 parcelas de R$ 100: quita 1, 2 e 3, põe R$ 47 na 4; um lote e um comprovante", async () => {
		const docs = series(10);
		const { db, docs: live } = fakeDb(docs);
		const st = store();
		const r = await adv(db, st, docs, { file: pdf });
		expect(r.status).toBe("ok");
		if (r.status !== "ok") return;
		expect(live.slice(0, 3).map((d) => shareOf(d).paidCents)).toEqual([10000, 10000, 10000]);
		expect(shareOf(live[3])).toMatchObject({ paidCents: 4700 });
		expect(dueCents(shareOf(live[3]), "u1")).toBe(5300);
		for (const d of live.slice(4)) expect(shareOf(d).paidCents).toBe(0);
		// um só lote, um só comprovante, upload uma vez
		expect(st.put).toHaveBeenCalledTimes(1);
		const batchIds = new Set(live.slice(0, 4).map((d) => (shareOf(d).batch ?? shareOf(d).parts?.[0]?.batch)?.id));
		expect(batchIds.size).toBe(1);
		const keys = new Set(live.slice(0, 4).flatMap((d) => receiptKeysOfShare(shareOf(d))));
		expect(keys.size).toBe(1);
		expect(shareOf(live[0]).batch).toMatchObject({ totalCents: 34700, count: 4 });
		expect(shareOf(live[0]).method).toBe("self");
		for (const d of live) expect(checkShareInvariant(shareOf(d))).toEqual([]);
		expect(r.advance.items.map((i) => [i.number, i.cents, i.settled])).toEqual([[1, 10000, true], [2, 10000, true], [3, 10000, true], [4, 4700, false]]);
		expect(r.fact).toMatchObject({ actorUid: "u2", debtorUid: "u2", paidBy: "u1", manual: false, totalCents: 34700 });
		expect(r.expense?.id).toBe(id(docs[0]));
	});

	it("o servidor ignora qualquer ideia do cliente sobre a divisão: só valor e total entram", async () => {
		const docs = series(3);
		const { db, docs: live } = fakeDb(docs);
		const r = await adv(db, store(), docs, { amountCents: 15000 });
		expect(r.status).toBe("ok");
		expect(live.map((d) => shareOf(d).paidCents)).toEqual([10000, 5000, 0]);
	});

	it("começa SEMPRE pela parcela em aberto mais antiga, mesmo com outra parcela aberta na tela", async () => {
		const docs = series(5);
		const { db, docs: live } = fakeDb(docs);
		// a pessoa está na parcela 4, mas as parcelas 1 a 5 estão em aberto: o dinheiro vai primeiro para a 1
		const r = await adv(db, store(), docs, { eid: id(docs[3]), amountCents: 25000, expectedDueCents: total(docs) });
		expect(r.status).toBe("ok");
		expect(live.map((d) => shareOf(d).paidCents)).toEqual([10000, 10000, 5000, 0, 0]);
		if (r.status === "ok") expect(r.advance.items.map((i) => i.number)).toEqual([1, 2, 3]);
	});

	it("o total esperado é o da compra toda (parcelas anteriores incluídas)", async () => {
		const docs = series(4);
		const { db } = fakeDb(docs);
		const onlyFromThird = total(docs.slice(2));
		expect(await adv(db, store(), docs, { eid: id(docs[2]), amountCents: 100, expectedDueCents: onlyFromThird })).toEqual({ status: "stale" });
	});
});

describe("advanceInstallments: parcelas diferentes (cashback) e estados no meio", () => {
	it("parcelas com valores diferentes", async () => {
		const docs = series(4, (n) => (n === 1 ? 9000 : 9500));
		const { db, docs: live } = fakeDb(docs);
		const r = await adv(db, store(), docs, { amountCents: 20000 });
		expect(r.status).toBe("ok");
		expect(live.map((d) => shareOf(d).paidCents)).toEqual([9000, 9500, 1500, 0]);
	});

	it("pula parcela já quitada, completa a parcialmente paga e ignora parcela em que a pessoa não participa", async () => {
		const docs = series(5, () => 10000, (n) => (n === 1 ? { shares: [share("u1", 10000), share("u2", 10000, 10000)] } : n === 2 ? { shares: [share("u1", 10000), share("u2", 10000, 6000)] } : n === 3 ? { shares: [share("u1", 20000), share("u3", 10000), share("u2", 0)] } : {}));
		const { db, docs: live } = fakeDb(docs);
		const r = await adv(db, store(), docs, { amountCents: 9000 });
		expect(r.status).toBe("ok");
		if (r.status !== "ok") return;
		expect(r.advance.items.map((i) => [i.number, i.cents])).toEqual([[2, 4000], [4, 5000]]);
		expect(shareOf(live[0]).paidCents).toBe(10000);
		expect(shareOf(live[1]).paidCents).toBe(10000);
		expect(live[2].shares.find((s) => s.uid === "u2")!.paidCents).toBe(0);
		expect(shareOf(live[3]).paidCents).toBe(5000);
	});
});

describe("advanceInstallments: permissões, por modo e por parcela", () => {
	it("paguei: só a própria pessoa ou quem cuida dela; os outros recebem forbidden sem gravar nem subir arquivo", async () => {
		const docs = series(3);
		const { db, expenses } = fakeDb(docs);
		const st = store();
		for (const uid of ["u3", "u1", "adm"]) expect(await adv(db, st, docs, { uid, file: pdf })).toEqual({ status: "forbidden" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
		expect(st.put).not.toHaveBeenCalled();
	});

	it("paguei por quem cuida: o responsável adianta pela pessoa sem celular", async () => {
		const docs = series(3, () => 10000, () => ({ shares: [share("u1", 10000), share("m_ben", 10000)] }));
		const { db, docs: live } = fakeDb(docs);
		const r = await adv(db, store(), docs, { uid: "u2", shareUid: "m_ben", amountCents: 12000, expectedDueCents: 30000 });
		expect(r.status).toBe("ok");
		expect(live.map((d) => shareOf(d, "m_ben").paidCents)).toEqual([10000, 2000, 0]);
		if (r.status === "ok") expect(r.fact).toMatchObject({ actorUid: "u2", debtorUid: "m_ben", manual: false });
	});

	it("recebi: quem pagou registra como manual; o administrador, com byAdmin; os demais recusados", async () => {
		const docs = series(3);
		const owner = fakeDb(docs);
		const r1 = await adv(owner.db, store(), docs, { uid: "u1", mode: "manual", amountCents: 15000 });
		expect(r1.status).toBe("ok");
		expect(shareOf(owner.docs[0])).toMatchObject({ method: "manual", markedBy: "u1" });
		expect(shareOf(owner.docs[0]).markedByAdmin).toBeUndefined();
		if (r1.status === "ok") expect(r1.fact.manual).toBe(true);

		const docs2 = series(3);
		const admin = fakeDb(docs2);
		const r2 = await adv(admin.db, store(), docs2, { uid: "adm", mode: "manual", amountCents: 15000 });
		expect(r2.status).toBe("ok");
		expect(shareOf(admin.docs[0])).toMatchObject({ method: "manual", markedByAdmin: true });
		expect(shareOf(admin.docs[1]).parts?.[0]).toMatchObject({ method: "manual", byAdmin: true, cents: 5000 });

		const docs3 = series(3);
		const denied = fakeDb(docs3);
		for (const uid of ["u2", "u3"]) expect(await adv(denied.db, store(), docs3, { uid, mode: "manual" })).toEqual({ status: "forbidden" });
		expect(denied.expenses.updateOne).not.toHaveBeenCalled();
	});

	it("ao pagar, ninguém paga a parte de quem pagou aquela parcela (guarda explícita)", async () => {
		const docs = series(2);
		const { db, expenses } = fakeDb(docs);
		expect(await adv(db, store(), docs, { uid: "u1", shareUid: "u1", expectedDueCents: 0, amountCents: 100 })).toEqual({ status: "forbidden" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
	});

	it("quem não é do grupo e despesa inexistente: respostas de 404 iguais por tipo; não parcelada recusa", async () => {
		const docs = series(2);
		const { db } = fakeDb(docs);
		expect(await adv(db, store(), docs, { uid: "intruso" })).toEqual({ status: "no_group" });
		expect(await adv(db, store(), docs, { eid: new ObjectId().toHexString() })).toEqual({ status: "no_expense" });
		const single = series(1, () => 10000, () => ({ installment: undefined }));
		const f = fakeDb(single);
		expect(await adv(f.db, store(), single, { expectedDueCents: 10000 })).toEqual({ status: "not_installment" });
		expect(await adv(db, store(), docs, { uid: "adm", mode: "manual", shareUid: "ninguem", expectedDueCents: 0 })).toEqual({ status: "no_share" });
	});
});

describe("advanceInstallments: conferências antes de gravar", () => {
	it("expectedDueCents diferente do total de agora: stale, nada gravado e nenhum arquivo subido", async () => {
		const docs = series(3);
		const { db, expenses } = fakeDb(docs);
		const st = store();
		expect(await adv(db, st, docs, { expectedDueCents: total(docs) - 1, file: pdf })).toEqual({ status: "stale" });
		expect(await adv(db, st, docs, { expectedDueCents: total(docs) + 100, file: pdf })).toEqual({ status: "stale" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
		expect(st.put).not.toHaveBeenCalled();
	});

	it("valor maior que o total: too_much; valor inválido: invalid_amount; nada gravado", async () => {
		const docs = series(3);
		const { db, expenses } = fakeDb(docs);
		const st = store();
		expect(await adv(db, st, docs, { amountCents: 30001, file: pdf })).toEqual({ status: "too_much" });
		for (const bad of [0, -5, 1.5, Number.NaN]) expect(await adv(db, st, docs, { amountCents: bad, file: pdf })).toEqual({ status: "invalid_amount" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
		expect(st.put).not.toHaveBeenCalled();
	});

	it("pagar tudo que falta quita a série; nunca gera devolução", async () => {
		const docs = series(3);
		const { db, docs: live } = fakeDb(docs);
		const r = await adv(db, store(), docs, { amountCents: 30000 });
		expect(r.status).toBe("ok");
		for (const d of live) expect(shareOf(d)).toMatchObject({ paidCents: 10000 });
		expect(total(live)).toBe(0);
		expect(await adv(db, store(), live, { amountCents: 1, expectedDueCents: 0 })).toEqual({ status: "too_much" });
	});

	it("destinatários diferentes na série: o adiantamento cobre só as parcelas do primeiro destinatário; o resto fica para depois", async () => {
		const docs = series(3, () => 10000, (n) => (n >= 2 ? { paidBy: "u3", shares: [share("u3", 10000), share("u2", 10000)] } : {}));
		const f = fakeDb(docs);
		const plan = await getAdvancePlan(f.db, GID, id(docs[2]), "u2", "u2");
		if (plan.status !== "ok") throw new Error("plano");
		expect(plan.plan).toMatchObject({ currentNumber: 3, thisDueCents: 0, totalDueCents: 10000, moreRecipients: true });
		expect(plan.plan.items.map((i) => i.number)).toEqual([1]);
		expect(plan.plan.recipient).toMatchObject({ id: rid("self"), pix: { key: PIX.key } });
		expect(await adv(f.db, store(), docs, { eid: id(docs[2]), amountCents: 15000, expectedDueCents: 10000 })).toEqual({ status: "too_much" });
		expect((await adv(f.db, store(), docs, { eid: id(docs[2]), amountCents: 10000, expectedDueCents: 10000 })).status).toBe("ok");
		expect(f.docs.map((d) => shareOf(d).paidCents)).toEqual([10000, 0, 0]);
	});

	it("tela na parcela 3 (pagou A) e parcela 1 em aberto paga por B: o plano devolve o Pix de B e o envio com o id de A é recusado", async () => {
		const docs = series(3, () => 10000, (n) => (n === 1 ? { paidBy: "u3", pix: { ...OTHER_PIX }, shares: [share("u3", 10000), share("u2", 10000)] } : {}));
		const f = fakeDb(docs);
		const plan = await getAdvancePlan(f.db, GID, id(docs[2]), "u2", "u2");
		if (plan.status !== "ok") throw new Error("plano");
		expect(plan.plan.recipient).toMatchObject({ id: rid("self", "u3", OTHER_PIX), pix: { key: OTHER_PIX.key } });
		expect(plan.plan.items.map((i) => i.number)).toEqual([1]);
		const st = store();
		const wrong = await adv(f.db, st, docs, { eid: id(docs[2]), amountCents: 5000, expectedDueCents: 10000, recipientId: rid("self", "u1", PIX), file: pdf });
		expect(wrong).toEqual({ status: "recipient_changed" });
		expect(f.expenses.updateOne).not.toHaveBeenCalled();
		expect(st.put).not.toHaveBeenCalled();
		const right = await adv(f.db, st, docs, { eid: id(docs[2]), amountCents: 5000, expectedDueCents: 10000, recipientId: plan.plan.recipient!.id });
		expect(right.status).toBe("ok");
	});

	it("a chave Pix mudou entre a tela e o envio: 'recipient_changed' sem gravar; ao receber, só quem pagou importa", async () => {
		const docs = series(2);
		const { db, expenses } = fakeDb(docs);
		expect(await adv(db, store(), docs, { recipientId: rid("self", "u1", OTHER_PIX), amountCents: 100 })).toEqual({ status: "recipient_changed" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
		const docsC = series(2, () => 10000, (n) => (n === 2 ? { pix: { ...OTHER_PIX } } : {}));
		const c = fakeDb(docsC);
		expect((await adv(c.db, store(), docsC, { uid: "u1", mode: "manual", amountCents: 15000 })).status).toBe("ok");
		const docsD = series(2, () => 10000, (n) => (n === 2 ? { pix: { ...OTHER_PIX } } : {}));
		const d = fakeDb(docsD);
		expect(await adv(d.db, store(), docsD, { amountCents: 15000, expectedDueCents: 10000 })).toEqual({ status: "too_much" });
	});

	it("o aviso sai das parcelas gravadas: destinatário e link da primeira tocada, não os da parcela aberta na tela", async () => {
		const docs = series(3, () => 10000, (n) => (n === 1 ? { paidBy: "u3", shares: [share("u3", 10000), share("u2", 10000)] } : {}));
		const { db } = fakeDb(docs);
		const r = await adv(db, store(), docs, { eid: id(docs[2]), amountCents: 10000, expectedDueCents: 10000, recipientId: rid("self", "u3") });
		expect(r.status).toBe("ok");
		if (r.status !== "ok") return;
		expect(r.fact).toMatchObject({ paidBy: "u3", expenseId: id(docs[0]), totalCents: 10000 });
	});

	it("parcela com pagamentos parciais demais: too_many_parts antes de qualquer gravação ou upload", async () => {
		const parts = Array.from({ length: 20 }, (_, k) => ({ id: `p${k}`, cents: 10, at: NOW, markedBy: "u2", method: "self" as const }));
		const docs = series(3, () => 10000, (n) => (n === 2 ? { shares: [share("u1", 10000), { uid: "u2", amountCents: 10000, paidCents: 200, parts }] } : {}));
		const { db, expenses } = fakeDb(docs);
		const st = store();
		// 10000 quita a 1 e põe 9800 na 2 (já com 20 parciais)... a 2 só receberia o pedaço: 5000 -> parcial novo, passa do teto
		expect(await adv(db, st, docs, { amountCents: 15000, file: pdf })).toEqual({ status: "too_many_parts" });
		expect(expenses.updateOne).not.toHaveBeenCalled();
		expect(st.put).not.toHaveBeenCalled();
	});
});

describe("advanceInstallments: tudo ou nada", () => {
	it("uma parcela perde a corrida no meio: as gravadas voltam, o comprovante é apagado e nenhuma resposta de sucesso sai", async () => {
		const docs = series(4);
		const original = clone(docs);
		const { db, docs: live } = fakeDb(docs, { lose: new Set([id(docs[2])]) });
		const st = store();
		const r = await adv(db, st, docs, { amountCents: 25000, file: pdf });
		expect(r).toEqual({ status: "conflict" });
		for (const n of [0, 1]) {
			expect(live[n].shares).toEqual(original[n].shares);
			expect(live[n].version).toBe(2); // gravou e restaurou
		}
		expect(live[2].version).toBe(0);
		expect(st.put).toHaveBeenCalledTimes(1);
		expect(st.delete).toHaveBeenCalledTimes(1); // o comprovante não ficou órfão
		const key = (st.put.mock.calls[0] as unknown as [string])[0];
		expect(st.delete.mock.calls[0][0]).toEqual([key]);
	});

	it("conflito na primeira parcela: nada gravado, comprovante apagado", async () => {
		const docs = series(2);
		const { db, docs: live } = fakeDb(docs, { lose: new Set([id(docs[0])]) });
		const st = store();
		expect(await adv(db, st, docs, { amountCents: 15000, file: pdf })).toEqual({ status: "conflict" });
		expect(live[0].version).toBe(0);
		expect(live.map((d) => shareOf(d).paidCents)).toEqual([0, 0]); // a parcela 2 (gravada em paralelo) também voltou
		expect(st.delete).toHaveBeenCalledTimes(1);
	});

	it("parte mudou entre a leitura e a gravação (outro pagamento): stale e desfaz o que já foi gravado", async () => {
		const docs = series(3);
		const original = clone(docs);
		const { db, docs: live, expenses } = fakeDb(docs);
		// logo antes da primeira gravação, alguém paga parte da parcela 2 (muda paidCents e a versão)
		const real = expenses.updateOne.getMockImplementation()!;
		let n = 0;
		expenses.updateOne.mockImplementation(async (f, u) => {
			if (++n === 1) {
				live[1].shares = [share("u1", 10000), { uid: "u2", amountCents: 10000, paidCents: 1000, parts: [{ id: "x", cents: 1000, at: NOW, markedBy: "u2", method: "self" }] }];
				live[1].version = 5;
			}
			return real(f, u);
		});
		const r = await adv(db, store(), docs, { amountCents: 15000 });
		expect(r).toEqual({ status: "stale" });
		expect(live[0].shares).toEqual(original[0].shares);
		expect(shareOf(live[1]).paidCents).toBe(1000); // o pagamento do outro ficou
	});

	it("se alguém mexeu numa parcela já gravada, o desfazer tira só o pagamento deste adiantamento", async () => {
		const docs = series(3);
		const { db, docs: live, expenses } = fakeDb(docs, { lose: new Set([id(docs[2])]) });
		const real = expenses.updateOne.getMockImplementation()!;
		let hooked = false;
		expenses.updateOne.mockImplementation(async (f, u) => {
			const res = await real(f, u);
			if (!hooked && f._id.equals(docs[0]._id) && res.matchedCount) {
				hooked = true;
				live[0].version = (live[0].version ?? 0) + 1; // escrita concorrente logo após gravar a parcela 1
			}
			return res;
		});
		const r = await adv(db, store(), docs, { amountCents: 25000 });
		expect(r).toEqual({ status: "conflict" });
		expect(shareOf(live[0]).paidCents).toBe(0);
		expect(shareOf(live[0]).batch).toBeUndefined();
		expect(checkShareInvariant(shareOf(live[0]))).toEqual([]);
		expect(shareOf(live[1]).paidCents).toBe(0);
	});

	it("desfazer inseguro (a parte ganhou devolução depois): não mexe, mantém o comprovante e responde 'uncertain'", async () => {
		const docs = series(3);
		const { db, docs: live, expenses } = fakeDb(docs, { lose: new Set([id(docs[2])]) });
		const real = expenses.updateOne.getMockImplementation()!;
		let hooked = false;
		expenses.updateOne.mockImplementation(async (f, u) => {
			const res = await real(f, u);
			if (!hooked && f._id.equals(docs[0]._id) && res.matchedCount) {
				hooked = true;
				shareOf(live[0]).refund = { cents: 500, at: NOW, markedBy: "u1" };
				live[0].version = (live[0].version ?? 0) + 1;
			}
			return res;
		});
		const st = store();
		const r = await adv(db, st, docs, { amountCents: 25000, file: pdf });
		expect(r).toEqual({ status: "uncertain" });
		expect(shareOf(live[0]).paidCents).toBe(10000); // não subtraiu demais
		expect(shareOf(live[0]).refund).toBeDefined();
		expect(st.delete).not.toHaveBeenCalled(); // a parcela 1 ainda referencia o comprovante
	});

	it("erro de banco no meio: desfaz o que pôde, apaga o comprovante e responde 'uncertain' (nunca só 'tente de novo')", async () => {
		const docs = series(3);
		const { db, docs: live } = fakeDb(docs, { throwOn: id(docs[1]) });
		const st = store();
		expect(await adv(db, st, docs, { amountCents: 25000, file: pdf })).toEqual({ status: "uncertain" });
		expect(shareOf(live[0]).paidCents).toBe(0);
		expect(shareOf(live[2]).paidCents).toBe(0);
		expect(st.delete).toHaveBeenCalledTimes(1);
	});

	it("a divisão mudou no meio (parte de R$ 100 virou R$ 120): para tudo, desfaz e responde 'stale'; nada diz 'parcela paga'", async () => {
		const docs = series(3);
		const original = clone(docs);
		const { db, docs: live, expenses } = fakeDb(docs);
		const real = expenses.updateOne.getMockImplementation()!;
		let n = 0;
		expenses.updateOne.mockImplementation(async (f, u) => {
			if (++n === 1) {
				live[1].shares = [share("u1", 12000), share("u2", 12000), share("m_ben", 0)];
				live[1].version = 7;
			}
			return real(f, u);
		});
		const r = await adv(db, store(), docs, { amountCents: 25000 });
		expect(r).toEqual({ status: "stale" });
		expect(live[0].shares).toEqual(original[0].shares);
		expect(live[2].shares).toEqual(original[2].shares);
		expect(shareOf(live[1]).paidCents).toBe(0);
	});

	it("gravou, mas a leitura do detalhe falhou: é sucesso (sem detalhe) e o aviso sai com o que foi gravado", async () => {
		const docs = series(3);
		const f = fakeDb(docs);
		const g = await f.db.collection("groups").findOne({ "members.uid": "u2" });
		const groups = f.db.collection("groups") as unknown as { findOne: ReturnType<typeof vi.fn> };
		groups.findOne.mockReset();
		groups.findOne.mockResolvedValueOnce(g).mockRejectedValue(new Error("caiu"));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const r = await adv(f.db, store(), docs, { amountCents: 15000 });
		expect(r.status).toBe("ok");
		if (r.status !== "ok") return;
		expect(r.expense).toBeNull();
		expect(r.fact).toMatchObject({ totalCents: 15000 });
		expect(r.fact.items.map((i) => [i.number, i.cents, i.settled, i.remainingCents])).toEqual([[1, 10000, true, 0], [2, 5000, false, 5000]]);
		expect(f.docs.map((d) => shareOf(d).paidCents)).toEqual([10000, 5000, 0]);
	});
});

describe("advanceInstallments: limpeza do comprovante", () => {
	it("erro ao liberar o comprovante não vira exceção: o resultado já decidido continua", async () => {
		const docs = series(2);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { db } = fakeDb(docs, { lose: new Set([id(docs[1])]), failRelease: true });
		expect(await adv(db, store(), docs, { amountCents: 15000, file: pdf })).toEqual({ status: "conflict" });
	});

	it("gravação em estado desconhecido e desfazer que não fechou limpo: o comprovante NÃO é apagado", async () => {
		const docs = series(3);
		const { db, docs: live, expenses } = fakeDb(docs, { throwOn: id(docs[2]) });
		const real = expenses.updateOne.getMockImplementation()!;
		expenses.updateOne.mockImplementation(async (f, u) => {
			const res = await real(f, u);
			if (f._id.equals(docs[0]._id) && res.matchedCount && !shareOf(live[0]).refund) {
				shareOf(live[0]).refund = { cents: 100, at: NOW, markedBy: "u1" };
				live[0].version = (live[0].version ?? 0) + 1;
			}
			return res;
		});
		const st = store();
		expect(await adv(db, st, docs, { amountCents: 25000, file: pdf })).toEqual({ status: "uncertain" });
		expect(st.delete).not.toHaveBeenCalled();
	});
});

describe("advanceInstallments: dois envios idênticos ao mesmo tempo", () => {
	it("exatamente um vence (ok) e o outro recebe 409 sem gravar; fica um adiantamento, o comprovante do vencedor e o do perdedor apagado", async () => {
		for (let round = 0; round < 5; round++) {
			const docs = series(6);
			const { db, docs: live } = fakeDb(docs);
			const st = store();
			const [a, b] = await Promise.all([adv(db, st, docs, { amountCents: 45000, file: pdf }), adv(db, st, docs, { amountCents: 45000, file: pdf })]);
			const statuses = [a.status, b.status].sort();
			expect(statuses).toEqual(["ok", "stale"]);
			expect(live.map((d) => shareOf(d).paidCents)).toEqual([10000, 10000, 10000, 10000, 5000, 0]);
			for (const d of live) expect(checkShareInvariant(shareOf(d))).toEqual([]);
			expect(st.put).toHaveBeenCalledTimes(2);
			expect(st.delete).toHaveBeenCalledTimes(1);
			const winner = (a.status === "ok" ? a : b) as Extract<typeof a, { status: "ok" }>;
			const keepKeys = new Set(live.flatMap((d) => receiptKeysOfShare(shareOf(d))));
			expect(keepKeys.size).toBe(1);
			expect(shareOf(live[0]).batch?.id).toBe(winner.advance.batchId);
			const deleted = (st.delete.mock.calls[0] as unknown as [string[]])[0];
			expect(deleted).toHaveLength(1);
			expect(keepKeys.has(deleted[0])).toBe(false);
		}
	});
});

describe("advanceInstallments: tempo (gravação em paralelo com teto)", () => {
	const slow = (docs: Doc[]) => {
		const f = fakeDb(docs);
		const real = f.expenses.updateOne.getMockImplementation()!;
		const stat = { now: 0, max: 0 };
		f.expenses.updateOne.mockImplementation(async (a, b) => {
			stat.max = Math.max(stat.max, ++stat.now);
			await new Promise((r) => setTimeout(r, 3));
			try {
				return await real(a, b);
			} finally {
				stat.now--;
			}
		});
		return { ...f, stat };
	};

	it("48 parcelas: no máximo 4 gravações ao mesmo tempo, e o estado final respeita a ordem (anteriores quitadas antes da seguinte)", async () => {
		const docs = series(48);
		const { db, docs: live, stat } = slow(docs);
		const r = await adv(db, store(), docs, { amountCents: 100 * 100 * 30 + 4700, expectedDueCents: 48 * 10000 });
		expect(r.status).toBe("ok");
		expect(stat.max).toBeGreaterThan(1);
		expect(stat.max).toBeLessThanOrEqual(WRITE_CONCURRENCY);
		const paid = live.map((d) => shareOf(d).paidCents);
		expect(paid.slice(0, 30).every((p) => p === 10000)).toBe(true);
		expect(paid[30]).toBe(4700);
		expect(paid.slice(31).every((p) => p === 0)).toBe(true);
	});

	it("48 parcelas com a última perdendo a corrida: desfaz as 47 em paralelo (teto) e fica como antes", async () => {
		const docs = series(48);
		const original = clone(docs);
		const f = slow(docs);
		const lost = fakeDb(docs, { lose: new Set([id(docs[47])]) });
		void f;
		const real = lost.expenses.updateOne.getMockImplementation()!;
		const stat = { now: 0, max: 0 };
		lost.expenses.updateOne.mockImplementation(async (a, b) => {
			stat.max = Math.max(stat.max, ++stat.now);
			await new Promise((r) => setTimeout(r, 2));
			try {
				return await real(a, b);
			} finally {
				stat.now--;
			}
		});
		const r = await adv(lost.db, store(), docs, { amountCents: 48 * 10000, expectedDueCents: 48 * 10000 });
		expect(r).toEqual({ status: "conflict" });
		expect(stat.max).toBeLessThanOrEqual(WRITE_CONCURRENCY);
		for (const [i, d] of lost.docs.entries()) expect(d.shares).toEqual(original[i].shares);
	});
});

describe("comprovante do lote e desfazer por parcela", () => {
	it("desfazer uma parcela não apaga o comprovante enquanto outra o referencia; só a última referência o apaga", async () => {
		const docs = series(3);
		const { db, docs: live } = fakeDb(docs);
		const st = store();
		const r = await adv(db, st, docs, { amountCents: 25000, file: pdf });
		expect(r.status).toBe("ok");
		const key = (st.put.mock.calls[0] as unknown as [string])[0];
		expect(key).toContain("receipts/batch/");

		// desfaz a parcela 3 (pagamento parcial de R$ 50): o comprovante segue nas outras duas
		const u3 = await setSharePaid(db, GID, id(live[2]), "u1", "u2", "pending", NOW, st, undefined, 5000);
		expect(u3.status).toBe("ok");
		expect(shareOf(live[2]).paidCents).toBe(0);
		expect(st.delete).not.toHaveBeenCalled();
		const u2 = await setSharePaid(db, GID, id(live[1]), "u1", "u2", "pending", NOW, st, undefined, 10000);
		expect(u2.status).toBe("ok");
		expect(st.delete).not.toHaveBeenCalled();
		const u1 = await setSharePaid(db, GID, id(live[0]), "u1", "u2", "pending", NOW, st, undefined, 10000);
		expect(u1.status).toBe("ok");
		expect(st.delete).toHaveBeenCalledTimes(1);
		expect(st.delete.mock.calls[0][0]).toEqual([key]);
	});

	it("sem arquivo nenhum upload acontece e as partes ficam sem comprovante", async () => {
		const docs = series(2);
		const { db, docs: live } = fakeDb(docs);
		const st = store();
		const r = await adv(db, st, docs, { amountCents: 15000 });
		expect(r.status).toBe("ok");
		expect(st.put).not.toHaveBeenCalled();
		expect(live.flatMap((d) => receiptKeysOfShare(shareOf(d)))).toEqual([]);
		if (r.status === "ok") expect(r.advance.hasReceipt).toBe(false);
	});
});

describe("getAdvancePlan: permissão igual à do envio", () => {
	it("ao pagar, só a própria pessoa ou quem age por ela vê o plano (e a chave Pix); os demais recebem 403; ao receber, só quem pagou/administrador", async () => {
		const docs = series(2, () => 10000, () => ({ shares: [share("u1", 10000), share("m_ben", 10000)] }));
		const { db } = fakeDb(docs);
		const plan = (uid: string, who: string, mode: "self" | "manual") => getAdvancePlan(db, GID, id(docs[0]), uid, who, mode);
		expect((await plan("u2", "m_ben", "self")).status).toBe("ok"); // quem cuida
		expect((await plan("u3", "m_ben", "self")).status).toBe("forbidden");
		expect((await plan("adm", "m_ben", "self")).status).toBe("forbidden");
		expect((await plan("u1", "m_ben", "self")).status).toBe("forbidden"); // quem pagou não é quem paga
		expect((await plan("u1", "m_ben", "manual")).status).toBe("ok");
		expect((await plan("adm", "m_ben", "manual")).status).toBe("ok");
		expect((await plan("u3", "m_ben", "manual")).status).toBe("forbidden");
		const ok = await plan("u2", "m_ben", "self");
		expect(ok.status === "ok" && ok.plan.recipient?.pix?.key).toBe(PIX.key);
	});
});

describe("getAdvancePlan", () => {
	it("lista as parcelas em aberto desta em diante e o total; qualquer membro vê, quem é de fora não", async () => {
		const docs = series(4, () => 10000, (n) => (n === 3 ? { shares: [share("u1", 10000), share("u2", 10000, 4000)] } : {}));
		const { db } = fakeDb(docs);
		const r = await getAdvancePlan(db, GID, id(docs[1]), "u2", "u2");
		expect(r.status).toBe("ok");
		if (r.status !== "ok") return;
		expect(r.plan).toMatchObject({ currentNumber: 2, thisDueCents: 10000, totalDueCents: 36000 });
		expect(r.plan.items.map((i) => [i.number, i.dueCents])).toEqual([[1, 10000], [2, 10000], [3, 6000], [4, 10000]]);
		expect(await getAdvancePlan(db, GID, id(docs[1]), "intruso", "u2")).toEqual({ status: "no_group" });
		expect(await getAdvancePlan(db, GID, new ObjectId().toHexString(), "u2", "u2")).toEqual({ status: "no_expense" });
		expect(await getAdvancePlan(db, GID, id(docs[1]), "adm", "ninguem", "manual")).toEqual({ status: "no_share" });
	});
});
