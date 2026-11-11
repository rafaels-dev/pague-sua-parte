/**
 * Teste de integração contra o MongoDB REAL de desenvolvimento. Só roda com IT_MONGO=1:
 *   npm run db:it-expenses  (ou)  node --env-file=.env.local scripts/it-expenses.mjs
 * Cria grupos "__it__*" e usuários "__it__*" descartáveis e apaga tudo no final, mesmo se falhar.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));

const ENABLED = process.env.IT_MONGO === "1" && Boolean(process.env.MONGODB_URI);
const RUN = `__it__${Date.now().toString(36)}`;
const uid = (n: string) => `${RUN}_${n}`;
const [OWNER, A, B, C] = ["owner", "a", "b", "c"].map(uid);

describe.skipIf(!ENABLED)("integração: despesas no MongoDB real", () => {
	let client: MongoClient;
	let db: Db;
	const groupIds: ObjectId[] = [];
	// importados dinamicamente para não carregar o driver quando o teste está desligado
	let repo: typeof import("./repo");
	let groupsRepo: typeof import("@/lib/groups/repo");
	let shares: typeof import("./shares");
	const store = { put: async () => undefined, get: async () => null, delete: async () => undefined } as never;

	async function newGroup(name: string, members: string[]): Promise<string> {
		const g = await groupsRepo.createGroup(db, members[0], `__it__ ${RUN} ${name}`);
		const _id = new ObjectId(g.id);
		groupIds.push(_id);
		await groupsRepo.groupsCollection(db).updateOne(
			{ _id },
			{ $push: { members: { $each: members.slice(1).map((u) => ({ uid: u, role: "member" as const, joinedAt: new Date() })) } } },
		);
		return g.id;
	}
	const ok = <T extends { status: string }>(r: T) => {
		expect(r.status).toBe("ok");
		return r as Extract<T, { status: "ok" }>;
	};
	const rawDocs = (gid: string) => repo.expensesCollection(db).find({ groupId: new ObjectId(gid) }).toArray();

	beforeAll(async () => {
		client = new MongoClient(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 10_000 });
		await client.connect();
		db = client.db(process.env.MONGODB_DB || "despesas");
		repo = await import("./repo");
		groupsRepo = await import("@/lib/groups/repo");
		shares = await import("./shares");
		await db.collection<{ _id: string }>("users").insertMany(
			[OWNER, A, B, C].map((u) => ({ _id: u, name: u.slice(-5), email: `${u}@example.invalid`, pixKey: { type: "email", key: `${u}@example.invalid` } })) as never,
		);
	});

	afterAll(async () => {
		if (!client) return;
		try {
			await repo.expensesCollection(db).deleteMany({ groupId: { $in: groupIds } });
			await groupsRepo.groupsCollection(db).deleteMany({ _id: { $in: groupIds }, name: { $regex: "^__it__" } });
			await db.collection("users").deleteMany({ _id: { $regex: `^${RUN}_` } } as never);
		} finally {
			await client.close();
		}
	});

	it("criar -> recalcular -> quitar -> reembolsar -> saldos", async () => {
		const g1 = await newGroup("g1", [OWNER, A, B, C]);
		const g2 = await newGroup("g2", [A, OWNER]);

		// 1. lançada só com o dono como participante
		const created = ok(await repo.createExpense(db, store, { groupId: g1, uid: OWNER, input: { description: "Mercado", amountCents: 3000, date: "2026-11-10", participantUids: [OWNER] }, files: [] })).expense;
		expect(created.shares.map((s) => [s.uid, s.amountCents, s.status])).toEqual([[OWNER, 3000, "payer"]]);
		const eid = created.id;
		expect((await rawDocs(g1))[0].version).toBe(0);

		// 2. mais gente entra na divisão
		let d = ok(await repo.updateParticipants(db, g1, eid, OWNER, [OWNER, A, B])).expense;
		expect(d.shares.map((s) => s.amountCents)).toEqual([1000, 1000, 1000]);
		expect((await rawDocs(g1))[0].version).toBe(1);

		// 3. A paga (marcado à mão)
		d = ok(await repo.setSharePaid(db, g1, eid, OWNER, A, "paid")).expense;
		expect(d.shares.find((s) => s.uid === A)).toMatchObject({ status: "paid", paidCents: 1000, dueCents: 0, method: "manual" });
		expect(await repo.getSummary(db, OWNER)).toMatchObject({ toReceiveCents: 1000, toPayCents: 0 });

		// 4. C entra depois: A passa a ter reembolso (750 de cota, pagou 1000)
		d = ok(await repo.updateParticipants(db, g1, eid, OWNER, [OWNER, A, B, C])).expense;
		expect(d.shares.find((s) => s.uid === A)).toMatchObject({ amountCents: 750, status: "refund", refundCents: 250 });
		expect(d.shares.reduce((t, s) => t + s.amountCents, 0)).toBe(3000);
		expect(await repo.getSummary(db, OWNER)).toMatchObject({ toReceiveCents: 1500, toPayCents: 250 });
		expect(await repo.getSummary(db, A)).toMatchObject({ toReceiveCents: 250, toPayCents: 0 });
		expect(await repo.getSummary(db, B)).toMatchObject({ toReceiveCents: 0, toPayCents: 750 });

		// 5. segundo grupo: despesa de A, dono deve 600 -> soma dos grupos
		const e2 = ok(await repo.createExpense(db, store, { groupId: g2, uid: A, input: { description: "Luz", amountCents: 1200, date: "2026-11-10", participantUids: [A, OWNER] }, files: [] })).expense;
		const sOwner = await repo.getSummary(db, OWNER);
		expect(sOwner).toMatchObject({ toReceiveCents: 1500, toPayCents: 850 });
		const list = await groupsRepo.listGroups(db, OWNER);
		const mine = list.filter((g) => groupIds.some((x) => x.toHexString() === g.id));
		expect(Object.fromEntries(mine.map((g) => [g.id, [g.toReceiveCents, g.toPayCents]]))).toEqual({ [g1]: [1500, 250], [g2]: [0, 600] });
		// a conta de saldos do usuário de teste só vê os grupos dele; confere contra a referência em JS
		for (const u of [OWNER, A, B, C]) {
			const docs = [...(await rawDocs(g1)), ...(await rawDocs(g2))];
			expect(await repo.getSummary(db, u)).toMatchObject(shares.balanceOf(docs, u));
		}

		// 6. A sai da divisão: cota 0 e reembolso integral (1000), linha por último
		d = ok(await repo.updateParticipants(db, g1, eid, OWNER, [OWNER, B, C])).expense;
		expect(d.shares.map((s) => s.uid)).toEqual([OWNER, B, C, A].sort((x, y) => (x === OWNER ? -1 : y === OWNER ? 1 : x === A ? 1 : y === A ? -1 : x.localeCompare(y))));
		expect(d.shares.at(-1)).toMatchObject({ uid: A, amountCents: 0, paidCents: 1000, status: "refund", refundCents: 1000, participates: false });
		expect(d.participantUids.sort()).toEqual([OWNER, B, C].sort());
		expect(await repo.getSummary(db, OWNER)).toMatchObject({ toReceiveCents: 2000, toPayCents: 1000 + 600 });

		// 7. despesa com pagamento não pode ser apagada
		expect((await repo.deleteExpense(db, store, g1, eid, OWNER)).status).toBe("has_payment");

		// 8. dono devolve o reembolso: a linha de A some
		d = ok(await repo.setSharePaid(db, g1, eid, OWNER, A, "paid")).expense;
		expect(d.shares.some((s) => s.uid === A)).toBe(false);
		expect(await repo.getSummary(db, OWNER)).toMatchObject({ toReceiveCents: 2000, toPayCents: 600 });
		expect(await repo.getSummary(db, A)).toMatchObject({ toReceiveCents: 600, toPayCents: 0 });

		// 9. A volta: começa do zero (pagou 0 depois de reembolsado) e desfazer é idempotente
		d = ok(await repo.updateParticipants(db, g1, eid, OWNER, [OWNER, A, B, C])).expense;
		expect(d.shares.find((s) => s.uid === A)).toMatchObject({ amountCents: 750, paidCents: 0, status: "pending", dueCents: 750 });
		ok(await repo.setSharePaid(db, g1, eid, OWNER, B, "paid"));
		d = ok(await repo.setSharePaid(db, g1, eid, OWNER, B, "pending")).expense;
		ok(await repo.setSharePaid(db, g1, eid, OWNER, B, "pending"));
		expect(d.shares.find((s) => s.uid === B)).toMatchObject({ status: "pending", paidCents: 0, paidAt: null, method: null });
		const raw = (await rawDocs(g1))[0];
		expect(raw.shares.find((s) => s.uid === B)).toEqual({ uid: B, amountCents: 750, paidCents: 0 }); // campos opcionais removidos de fato
		expect(raw.shares.reduce((t, s) => t + s.amountCents, 0)).toBe(3000);

		// 10. permissões
		expect((await repo.updateParticipants(db, g1, eid, A, [A])).status).toBe("forbidden");
		expect((await repo.setSharePaid(db, g1, eid, A, B, "paid")).status).toBe("forbidden");
		expect((await repo.setSharePaid(db, g1, eid, OWNER, OWNER, "paid")).status).toBe("no_share");
		expect((await repo.setSharePaid(db, g1, eid, OWNER, uid("ninguem"), "paid")).status).toBe("no_share");
		expect((await repo.updateParticipants(db, g1, eid, OWNER, [OWNER, uid("fora")])).status).toBe("invalid");

		// 11. lista
		const items = (await repo.listExpenses(db, g1, A))!;
		expect(items[0]).toMatchObject({ yourStatus: "pending", yourDueCents: 750, pendingCount: 3, refundCount: 0 });

		// 12. despesa sem pagamento pode ser apagada
		expect((await repo.deleteExpense(db, store, g2, e2.id, A)).status).toBe("ok");
		expect(await rawDocs(g2)).toHaveLength(0);
	}, 60_000);

	it("pessoa sem login: lançar, quitar pelo responsável, devolução, saldos, troca de responsável", async () => {
		const PIX = { type: "cpf", key: "52998224725" };
		// O resumo soma todos os grupos do usuário (o outro teste também usa estes uids): compara com a linha de base.
		const base = Object.fromEntries(await Promise.all([OWNER, A, B].map(async (u) => [u, await repo.getSummary(db, u)] as const)));
		const top = async (u: string, groupBalance: { toReceiveCents: number; toPayCents: number }) =>
			expect(await repo.getSummary(db, u)).toMatchObject({
				toReceiveCents: base[u].toReceiveCents + groupBalance.toReceiveCents,
				toPayCents: base[u].toPayCents + groupBalance.toPayCents,
			});
		const g = await newGroup("managed", [OWNER, A, B]);
		const added = await groupsRepo.addManagedMember(db, g, OWNER, { name: "Benjamim", managedBy: A, pixKey: PIX as never });
		if (added.status !== "ok") throw new Error("addManagedMember: " + added.status);
		const BEN = added.uid;
		expect(BEN).toMatch(/^m_/);
		// responsável precisa ser membro real; só admin cria
		expect((await groupsRepo.addManagedMember(db, g, A, { name: "X", managedBy: A })).status).toBe("forbidden");
		expect((await groupsRepo.addManagedMember(db, g, OWNER, { name: "X", managedBy: BEN })).status).toBe("invalid");
		const detail = (await groupsRepo.getGroupDetail(db, g, A))!;
		expect(detail.members.find((m) => m.uid === BEN)).toMatchObject({ kind: "managed", youManage: true, canEdit: true, pixKey: PIX, managedBy: { uid: A, isYou: true } });
		expect((await groupsRepo.getGroupDetail(db, g, B))!.members.find((m) => m.uid === BEN)).not.toHaveProperty("pixKey");

		// 1. Benjamim paga 3000 (lançado por A), dividido com OWNER e B
		expect(await repo.createExpense(db, store, { groupId: g, uid: B, input: { description: "x", amountCents: 3000, date: "2026-11-10", participantUids: [B, BEN], paidByUid: BEN }, files: [] })).toMatchObject({ status: "invalid", field: "paidByUid" });
		const e1 = ok(await repo.createExpense(db, store, { groupId: g, uid: A, input: { description: "Farmácia", amountCents: 3000, date: "2026-11-10", participantUids: [BEN, OWNER, B], paidByUid: BEN }, files: [] })).expense;
		expect(e1.paidBy).toMatchObject({ uid: BEN, name: "Benjamim", kind: "managed", youManage: true });
		const raw1 = (await rawDocs(g))[0];
		expect(raw1).toMatchObject({ paidBy: BEN, createdBy: A, pix: { key: PIX.key, payeeName: "Benjamim" } });

		// 2. só o responsável quita; OWNER (admin) e B não
		expect((await repo.setSharePaid(db, g, e1.id, B, OWNER, "paid")).status).toBe("forbidden");
		expect((await repo.setSharePaid(db, g, e1.id, OWNER, OWNER, "paid")).status).toBe("forbidden");
		const d1 = ok(await repo.setSharePaid(db, g, e1.id, A, OWNER, "paid")).expense;
		expect(d1.shares.find((s) => s.uid === OWNER)).toMatchObject({ status: "paid", paidCents: 1000 });
		expect((await rawDocs(g))[0].shares.find((s) => s.uid === OWNER)).toMatchObject({ markedBy: A });

		// 3. OWNER lança 1200 com Benjamim e A devendo
		const e2 = ok(await repo.createExpense(db, store, { groupId: g, uid: OWNER, input: { description: "Luz", amountCents: 1200, date: "2026-11-10", participantUids: [OWNER, BEN, A] }, files: [] })).expense;

		const balances = async () => {
			const docs = await rawDocs(g);
			return Object.fromEntries(await Promise.all([OWNER, A, B, BEN].map(async (u) => [u, shares.balanceOf(docs, u)] as const)));
		};
		expect(await balances()).toMatchObject({
			[OWNER]: { toReceiveCents: 800, toPayCents: 0 },
			[A]: { toReceiveCents: 0, toPayCents: 400 },
			[B]: { toReceiveCents: 0, toPayCents: 1000 },
			[BEN]: { toReceiveCents: 1000, toPayCents: 400 },
		});
		// resumo da responsável: o topo é só dela; Benjamim vem em managed
		await top(A, { toReceiveCents: 0, toPayCents: 400 });
		expect((await repo.getSummary(db, A)).managed).toEqual([
			{ uid: BEN, name: "Benjamim", groupId: g, groupName: expect.any(String), toReceiveCents: 1000, toPayCents: 400, toReceiveNowCents: 1000, toPayNowCents: 400, overdueToPayCents: 0 },
		]);
		await top(OWNER, { toReceiveCents: 800, toPayCents: 0 });
		expect((await repo.getSummary(db, OWNER)).managed).toEqual([]);
		// GET /api/groups continua sendo só o saldo próprio
		const mineA = (await groupsRepo.listGroups(db, A)).find((x) => x.id === g)!;
		expect([mineA.toReceiveCents, mineA.toPayCents]).toEqual([0, 400]);
		// lista pela ótica de A
		const items = (await repo.listExpenses(db, g, A))!;
		const i1 = items.find((i) => i.id === e1.id)!;
		const i2 = items.find((i) => i.id === e2.id)!;
		expect(i1.ownerView).toEqual({ pendingCount: 1, refundCount: 0 });
		expect(i1.managed).toEqual([]);
		expect(i2.managed).toEqual([{ uid: BEN, name: "Benjamim", status: "pending", dueCents: 400, refundCents: 0 }]);

		// 4. OWNER recebe o Pix da parte de Benjamim e marca
		ok(await repo.setSharePaid(db, g, e2.id, OWNER, BEN, "paid"));
		expect((await balances())[BEN]).toMatchObject({ toReceiveCents: 1000, toPayCents: 0 });
		expect((await repo.getSummary(db, A)).managed[0]).toMatchObject({ toReceiveCents: 1000, toPayCents: 0 });

		// 5. A tira OWNER da divisão da despesa de Benjamim: OWNER já tinha pago -> devolução por Benjamim
		const d5 = ok(await repo.updateParticipants(db, g, e1.id, A, [BEN, B])).expense;
		expect(d5.shares.find((s) => s.uid === OWNER)).toMatchObject({ status: "refund", refundCents: 1000, amountCents: 0 });
		expect((await balances())[BEN]).toMatchObject({ toReceiveCents: 1500, toPayCents: 1000 });
		expect((await balances())[OWNER]).toMatchObject({ toReceiveCents: 400 + 1000, toPayCents: 0 });
		expect((await repo.getSummary(db, A)).managed).toMatchObject([{ uid: BEN, toReceiveCents: 1500, toPayCents: 1000 }]);
		// A devolve pelo Benjamim
		const d6 = ok(await repo.setSharePaid(db, g, e1.id, A, OWNER, "paid")).expense;
		expect(d6.shares.some((s) => s.uid === OWNER)).toBe(false);
		expect((await repo.getSummary(db, A)).managed[0]).toMatchObject({ toReceiveCents: 1500, toPayCents: 0 });
		for (const u of [OWNER, A, B]) await top(u, (await balances())[u]);

		// 6. responsável substituído: A perde o acesso na hora; B passa a ter
		expect((await groupsRepo.removeMember(db, g, OWNER, A)).status).toBe("responsible");
		expect((await groupsRepo.updateManagedMember(db, g, A, BEN, { managedBy: B })).status).toBe("ok"); // A ainda era responsável
		expect((await groupsRepo.updateManagedMember(db, g, A, BEN, { name: "Ben" })).status).toBe("forbidden");
		expect((await repo.setSharePaid(db, g, e1.id, A, B, "paid")).status).toBe("forbidden");
		expect((await repo.updateParticipants(db, g, e1.id, A, [BEN])).status).toBe("forbidden");
		expect((await repo.getSummary(db, A)).managed).toEqual([]);
		expect((await repo.getSummary(db, B)).managed).toEqual([expect.objectContaining({ uid: BEN, toReceiveCents: 1500, toPayCents: 0 })]);
		expect((await repo.setSharePaid(db, g, e1.id, B, B, "paid")).status).toBe("ok");
		expect((await groupsRepo.setMemberRole(db, g, OWNER, BEN, "admin")).status).toBe("managed_target");
		expect((await groupsRepo.removeMember(db, g, OWNER, B)).status).toBe("responsible");
		expect((await groupsRepo.removeMember(db, g, OWNER, BEN)).status).toBe("ok");
		const after = ok(await repo.getExpenseDetail(db, g, e1.id, OWNER) as never) as unknown as { expense: { paidBy: { name: string } } };
		expect(after.expense.paidBy.name).toBe("Participante");
	}, 60_000);

	it("documento no modelo antigo (status 'paid') não pode ser apagado e entra nos saldos", async () => {
		const g = await newGroup("legacy", [OWNER, A]);
		const _id = new ObjectId();
		await repo.expensesCollection(db).insertOne({
			_id, groupId: new ObjectId(g), createdBy: OWNER, paidBy: OWNER, description: "Antiga", amountCents: 2000, date: "2026-01-01",
			pix: { type: "email", key: "x@example.invalid", payeeName: "O" },
			shares: [{ uid: OWNER, amountCents: 1000 }, { uid: A, amountCents: 1000, status: "paid" }],
			attachments: [], createdAt: new Date(), updatedAt: new Date(),
		} as never);
		expect((await repo.deleteExpense(db, store, g, _id.toHexString(), OWNER)).status).toBe("has_payment");
		expect(await repo.expensesCollection(db).countDocuments({ _id })).toBe(1);
		// o filtro atômico sozinho (sem a checagem em JS) também recusa
		const res = await repo.expensesCollection(db).deleteOne({ _id, shares: { $not: { $elemMatch: { $or: [{ paidCents: { $gt: 0 } }, { status: "paid" }] } } } });
		expect(res.deletedCount).toBe(0);
		const sum = await repo.getSummary(db, OWNER);
		const mineOnly = (await groupsRepo.listGroups(db, OWNER)).find((x) => x.id === g)!;
		expect([mineOnly.toReceiveCents, mineOnly.toPayCents]).toEqual([0, 0]); // cota legada já paga: nada a receber
		expect(sum.managed).toEqual([]);
	}, 60_000);

	it("edições concorrentes: versão otimista nunca perde atualização nem quebra o total", async () => {
		const g = await newGroup("conc", [OWNER, A, B, C]);
		const e = ok(await repo.createExpense(db, store, { groupId: g, uid: OWNER, input: { description: "Concorrência", amountCents: 1001, date: "2026-11-10", participantUids: [OWNER, A] }, files: [] })).expense;
		const lists = [[OWNER, A, B], [OWNER, B, C], [OWNER, A, C], [OWNER], [OWNER, A, B, C]];
		const results = await Promise.all(lists.map((l) => repo.updateParticipants(db, g, e.id, OWNER, l)));
		const okCount = results.filter((r) => r.status === "ok").length;
		const conflicts = results.filter((r) => r.status === "conflict").length;
		expect(okCount + conflicts).toBe(results.length);
		expect(okCount).toBeGreaterThanOrEqual(1);
		const raw = (await rawDocs(g))[0];
		expect(raw.version).toBe(okCount); // cada escrita bem-sucedida subiu a versão exatamente 1
		expect(raw.shares.reduce((t, s) => t + s.amountCents, 0)).toBe(1001);
		expect(lists.map((l) => [...l].sort().join())).toContain([...shares.participantUidsOf(raw.shares)].sort().join());
	}, 60_000);

	it("parcelas e vencimentos: série de 3 com anexo compartilhado, saldos agora x depois, apagar a partir de, ordem da lista", async () => {
		const dates = await import("./dates");
		const today = dates.todayInSaoPaulo();
		const eom = dates.lastDayOfMonth(today);
		const farFuture = dates.addMonthsClamped(today, 48); // quase 4 anos à frente
		// armazenamento falso em memória, para provar o que sobra no "R2"
		const objects = new Map<string, Uint8Array>();
		const fake = {
			put: async (k: string, b: Uint8Array) => void objects.set(k, b),
			get: async () => null,
			delete: async (ks: string[]) => void ks.forEach((k) => objects.delete(k)),
		} as never;
		const file = { name: "fatura.pdf", contentType: "application/pdf" as const, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]) };
		const GROUP_FIELDS = ["toReceiveCents", "toPayCents", "toReceiveNowCents", "toPayNowCents", "overdueToPayCents"] as const;
		const mineIn = async (u: string, gid: string) => (await groupsRepo.listGroups(db, u)).find((x) => x.id === gid)!;
		const expectRef = async (g: string, u: string) => {
			const ref = shares.balanceOf(await rawDocs(g), u);
			const got = await mineIn(u, g);
			for (const k of GROUP_FIELDS) expect(got[k], `${k} de ${u.slice(-1)}`).toBe(ref[k]);
		};
		const base = Object.fromEntries(await Promise.all([OWNER, A, B].map(async (u) => [u, await repo.getSummary(db, u)] as const)));

		const g = await newGroup("parcelas", [OWNER, A, B]);
		// 1. compra de 3 parcelas de R$ 30,00 no cartão do dono, primeira no fim deste mês
		const created = ok(await repo.createExpense(db, fake, { groupId: g, uid: OWNER, input: { description: "Geladeira", amountCents: 3000, date: today, participantUids: [OWNER, A, B], dueDate: eom, installments: { count: 3 } }, files: [file] })).expense;
		let docs = (await rawDocs(g)).sort((x, y) => x.installment!.number - y.installment!.number);
		expect(docs).toHaveLength(3);
		expect(docs.map((d) => d.installment!.number)).toEqual([1, 2, 3]);
		expect(docs.map((d) => d.dueDate)).toEqual(dates.installmentDueDates(eom, 3));
		expect(created.id).toBe(docs[0]._id.toHexString());
		expect(created.series!.items).toHaveLength(3);
		expect(new Set(docs.map((d) => d.installment!.seriesId)).size).toBe(1);
		// um único objeto no "R2", referenciado pelas três
		expect(objects.size).toBe(1);
		const key = docs[0].attachments[0].key;
		expect(docs.every((d) => d.attachments.length === 1 && d.attachments[0].key === key)).toBe(true);

		// 2. saldos agora x depois (parcela 1 vence neste mês; 2 e 3 depois), contra a referência em JS
		const ownerNow = await mineIn(OWNER, g);
		expect(ownerNow).toMatchObject({ toReceiveCents: 6000, toReceiveNowCents: 2000, toPayCents: 0, overdueToPayCents: 0 });
		expect(await mineIn(A, g)).toMatchObject({ toPayCents: 3000, toPayNowCents: 1000, overdueToPayCents: 0 });
		for (const u of [OWNER, A, B]) await expectRef(g, u);
		// o resumo é a linha de base + este grupo, em todos os campos
		for (const u of [OWNER, A, B]) {
			const sum = await repo.getSummary(db, u);
			const gb = await mineIn(u, g);
			for (const k of GROUP_FIELDS) expect(sum[k], `summary ${k} de ${u.slice(-1)}`).toBe(base[u][k] + gb[k]);
		}

		// 3. despesa ATRASADA (venceu em 2020) e outra muito à frente
		const late = ok(await repo.createExpense(db, fake, { groupId: g, uid: A, input: { description: "Atrasada", amountCents: 800, date: "2026-01-02", participantUids: [A, B], dueDate: "2020-01-15" }, files: [] })).expense;
		expect(late).toMatchObject({ overdue: true, dueDate: "2020-01-15", installment: null });
		ok(await repo.createExpense(db, fake, { groupId: g, uid: A, input: { description: "Longe", amountCents: 600, date: today, participantUids: [A, B], dueDate: farFuture }, files: [] }));
		expect(await mineIn(B, g)).toMatchObject({ toPayCents: 1000 * 3 + 400 + 300, toPayNowCents: 1000 + 400, overdueToPayCents: 400 });
		expect(await mineIn(A, g)).toMatchObject({ toReceiveCents: 700, toReceiveNowCents: 400 });
		for (const u of [OWNER, A, B]) await expectRef(g, u);
		// refund conta sempre "agora": B paga a atrasada à vontade, depois sai da divisão -> devolução
		ok(await repo.setSharePaid(db, g, late.id, A, B, "paid"));
		ok(await repo.updateParticipants(db, g, late.id, A, [A]));
		expect(await mineIn(A, g)).toMatchObject({ toPayNowCents: 1000 + 400 /* 1ª parcela + devolução a B */ + 0 });
		for (const u of [OWNER, A, B]) await expectRef(g, u);

		// 4. detalhe da parcela 2: série e overdue
		const d2 = ok(await repo.getExpenseDetail(db, g, docs[1]._id.toHexString(), A) as never) as unknown as { expense: import("./repo").ExpenseDetail };
		expect(d2.expense).toMatchObject({ dueDate: docs[1].dueDate, overdue: false, installment: { number: 2, count: 3 } });
		expect(d2.expense.series!.items.map((i) => [i.number, i.settled])).toEqual([[1, false], [2, false], [3, false]]);

		// 5. quita a parcela 1; apaga a partir da 2 -> 2 saem, o anexo continua referenciado pela 1
		ok(await repo.setSharePaid(db, g, docs[0]._id.toHexString(), OWNER, A, "paid"));
		ok(await repo.setSharePaid(db, g, docs[0]._id.toHexString(), OWNER, B, "paid"));
		const r = await repo.deleteExpense(db, fake, g, docs[1]._id.toHexString(), OWNER, "following");
		expect(r).toEqual({ status: "ok", deleted: 2, kept: 0 });
		docs = (await rawDocs(g)).filter((d) => d.installment);
		expect(docs.map((d) => d.installment!.number)).toEqual([1]);
		expect(objects.has(key)).toBe(true);
		const d1 = ok(await repo.getExpenseDetail(db, g, docs[0]._id.toHexString(), A) as never) as unknown as { expense: import("./repo").ExpenseDetail };
		expect(d1.expense.series).toEqual({ count: 3, items: [{ id: docs[0]._id.toHexString(), number: 1, dueDate: eom, settled: true }] });
		// a parcela 1 tem pagamento: não apaga, e o objeto fica
		expect((await repo.deleteExpense(db, fake, g, docs[0]._id.toHexString(), OWNER, "following")).status).toBe("has_payment");
		expect(objects.has(key)).toBe(true);

		// 6. segunda série: pagamento na parcela 3; apagar a partir da 2 mantém a 3 e o anexo; mudar participantes a partir da 1
		const g2 = await newGroup("parcelas2", [OWNER, A, B]);
		ok(await repo.createExpense(db, fake, { groupId: g2, uid: OWNER, input: { description: "Sofa", amountCents: 3000, date: today, participantUids: [OWNER, A, B], dueDate: "2027-01-31", installments: { count: 4 } }, files: [file] }));
		let s2 = (await rawDocs(g2)).sort((x, y) => x.installment!.number - y.installment!.number);
		expect(s2.map((d) => d.dueDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
		const key2 = s2[0].attachments[0].key;
		expect(objects.has(key2)).toBe(true);
		const withTwo = ok(await repo.updateParticipants(db, g2, s2[1]._id.toHexString(), OWNER, [OWNER, A], "following")).expense;
		expect(withTwo.participantUids.sort()).toEqual([OWNER, A].sort());
		s2 = (await rawDocs(g2)).sort((x, y) => x.installment!.number - y.installment!.number);
		expect(s2.map((d) => shares.participantUidsOf(d.shares).length)).toEqual([3, 2, 2, 2]);
		expect(s2.map((d) => d.version)).toEqual([0, 1, 1, 1]);
		ok(await repo.setSharePaid(db, g2, s2[2]._id.toHexString(), OWNER, A, "paid"));
		const r2 = await repo.deleteExpense(db, fake, g2, s2[1]._id.toHexString(), OWNER, "following");
		expect(r2).toEqual({ status: "ok", deleted: 2, kept: 1 }); // 2 e 4 saem; 3 tem pagamento
		expect((await rawDocs(g2)).map((d) => d.installment!.number).sort()).toEqual([1, 3]);
		expect(objects.has(key2)).toBe(true);
		// apagar a 1 (sem pagamento) mantém o objeto porque a 3 ainda o usa; a 3 não apaga
		expect((await repo.deleteExpense(db, fake, g2, s2[0]._id.toHexString(), OWNER)).status).toBe("ok");
		expect(objects.has(key2)).toBe(true);
		expect((await repo.deleteExpense(db, fake, g2, s2[2]._id.toHexString(), OWNER)).status).toBe("has_payment");
		// desfaz o pagamento e apaga a última referência: só então o objeto sai
		ok(await repo.setSharePaid(db, g2, s2[2]._id.toHexString(), OWNER, A, "pending"));
		expect((await repo.deleteExpense(db, fake, g2, s2[2]._id.toHexString(), OWNER)).status).toBe("ok");
		expect(objects.has(key2)).toBe(false);
		expect(objects.has(key)).toBe(true); // o da primeira série segue vivo (parcela 1 paga)

		// 7. ordem da lista: em aberto por vencimento (sem vencimento vale a data da compra), depois quitadas mais novas primeiro
		const g3 = await newGroup("ordem", [OWNER, A]);
		const mk = async (description: string, date: string, extra: { dueDate?: string; settle?: boolean }) => {
			const e = ok(await repo.createExpense(db, fake, { groupId: g3, uid: OWNER, input: { description, amountCents: 1000, date, participantUids: [OWNER, A], ...(extra.dueDate ? { dueDate: extra.dueDate } : {}) }, files: [] })).expense;
			if (extra.settle) ok(await repo.setSharePaid(db, g3, e.id, OWNER, A, "paid"));
			return e.id;
		};
		const eFar = await mk("longe", "2026-02-01", { dueDate: farFuture });
		const eToday = await mk("hoje", today, {});
		const ePast = await mk("passado", "2026-03-01", { dueDate: "2024-05-05" });
		const eNewSettled = await mk("quitada nova", "2026-03-01", { settle: true });
		const eOldSettled = await mk("quitada velha", "2026-01-02", { settle: true, dueDate: "2020-01-01" });
		const order = async () => (await repo.listExpenses(db, g3, A))!;
		let list = await order();
		expect(list.map((i) => i.id)).toEqual([ePast, eToday, eFar, eNewSettled, eOldSettled]);
		expect(list.map((i) => i.settled)).toEqual([false, false, false, true, true]);
		expect(list.map((i) => i.overdue)).toEqual([true, false, false, false, false]);
		// quitar a "passado" a manda para o grupo das quitadas (data 2026-03-01, empata com a nova: createdAt desempata)
		ok(await repo.setSharePaid(db, g3, ePast, OWNER, A, "paid"));
		list = await order();
		expect(list.map((i) => i.id).slice(0, 2)).toEqual([eToday, eFar]);
		expect(list.slice(2).every((i) => i.settled)).toBe(true);
		expect(list.slice(2).map((i) => i.id)).toEqual([eNewSettled, ePast, eOldSettled]); // mesma data (2026-03-01): a criada por último vem primeiro
	}, 120_000);
});
