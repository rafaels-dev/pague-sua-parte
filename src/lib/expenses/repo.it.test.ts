/**
 * Teste de integração contra o MongoDB REAL de desenvolvimento. Só roda com IT_MONGO=1:
 *   npm run db:it-expenses  (ou)  node --env-file=.env.local scripts/it-expenses.mjs
 * Cria grupos "__it__*" e usuários "__it__*" descartáveis e apaga tudo no final, mesmo se falhar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";


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

	it("comprovantes: já paguei com e sem arquivo, troca, desfazer do dono, proibido, responsável por pessoa sem login", async () => {
		const PIX = { type: "cpf", key: "52998224725" };
		const objects = new Map<string, Uint8Array>();
		const mem = {
			put: async (k: string, b: Uint8Array) => void objects.set(k, b),
			get: async () => null,
			delete: async (ks: string[]) => void ks.forEach((k) => objects.delete(k)),
		} as never;
		const png = (n: number) => ({ name: `pix${n}.png`, contentType: "image/png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]) });
		const g = await newGroup("comprovantes", [OWNER, A, B]);
		const added = await groupsRepo.addManagedMember(db, g, OWNER, { name: "Benjamim", managedBy: A, pixKey: PIX as never });
		if (added.status !== "ok") throw new Error("addManagedMember: " + added.status);
		const BEN = added.uid;
		const e = ok(await repo.createExpense(db, mem, { groupId: g, uid: OWNER, input: { description: "Pizza", amountCents: 4000, date: "2026-11-10", participantUids: [OWNER, A, B, BEN] }, files: [] })).expense;
		const pay = (uid_: string, target: string, file?: ReturnType<typeof png>) => repo.markSelfPaid(db, mem, { groupId: g, eid: e.id, uid: uid_, targetUid: target, file });
		const raw = async () => (await rawDocs(g))[0].shares;
		const viewAs = async (u: string) => ok((await repo.getExpenseDetail(db, g, e.id, u)) as never) as unknown as { expense: import("./repo").ExpenseDetail };

		// 1. sem arquivo: quita como self; detalhe diz que pode anexar comprovante
		let d = ok(await pay(A, A)).expense;
		expect(d.shares.find((s) => s.uid === A)).toMatchObject({ status: "paid", method: "self", receipt: null, canPay: false, canAddReceipt: true });
		expect(objects.size).toBe(0);
		// 2. quem não age pela pessoa é barrado; dono e quem pagou não são alvo
		expect((await pay(B, A, png(1))).status).toBe("forbidden");
		expect((await pay(OWNER, A, png(1))).status).toBe("forbidden");
		expect((await pay(OWNER, OWNER)).status).toBe("no_share");
		expect((await pay(B, uid("ninguem"))).status).toBe("forbidden");
		expect(objects.size).toBe(0);
		// 3. anexa depois (cota já quitada): mantém method/paidAt e guarda o objeto em receipts/
		const paidAt = (await raw()).find((s) => s.uid === A)!.paidAt;
		d = ok(await pay(A, A, png(2))).expense;
		const first = (await raw()).find((s) => s.uid === A)!;
		expect(first).toMatchObject({ method: "self", markedBy: A, paidAt });
		expect(first.receipt!.key.startsWith(`receipts/${g}/${e.id}/`)).toBe(true);
		expect(objects.has(first.receipt!.key)).toBe(true);
		expect(d.shares.find((s) => s.uid === A)!.receipt).toEqual({ name: "pix2.png", contentType: "image/png", size: 5 });
		// 4. visibilidade: dono vê, outro membro não; a chave nunca sai
		expect((await viewAs(OWNER)).expense.shares.find((s) => s.uid === A)!.receipt).not.toBeNull();
		expect((await viewAs(B)).expense.shares.find((s) => s.uid === A)!.receipt).toBeNull();
		expect(JSON.stringify(await viewAs(A))).not.toContain("receipts/");
		expect(await repo.getReceiptRef(db, g, e.id, A, OWNER)).toMatchObject({ status: "ok", key: first.receipt!.key });
		expect((await repo.getReceiptRef(db, g, e.id, A, B)).status).toBe("not_found");
		// 5. troca: o objeto antigo some
		ok(await pay(A, A, png(3)));
		const second = (await raw()).find((s) => s.uid === A)!;
		expect(second.receipt!.id).not.toBe(first.receipt!.id);
		expect(objects.has(first.receipt!.key)).toBe(false);
		expect(objects.has(second.receipt!.key)).toBe(true);
		expect(objects.size).toBe(1);
		// 6. responsável (A) paga por Benjamim com comprovante; B não pode
		expect((await pay(B, BEN, png(4))).status).toBe("forbidden");
		d = ok(await pay(A, BEN, png(4))).expense;
		expect(d.shares.find((s) => s.uid === BEN)).toMatchObject({ status: "paid", method: "self" });
		expect((await raw()).find((s) => s.uid === BEN)).toMatchObject({ markedBy: A, method: "self" });
		expect(objects.size).toBe(2);
		expect((await repo.getReceiptRef(db, g, e.id, BEN, A)).status).toBe("ok");
		// 7. dono desfaz A: some o comprovante (dado e objeto); B segue pendente e paga com arquivo
		ok(await repo.setSharePaid(db, g, e.id, OWNER, A, "pending", undefined, mem));
		expect((await raw()).find((s) => s.uid === A)).toEqual({ uid: A, amountCents: 1000, paidCents: 0 });
		expect(objects.has(second.receipt!.key)).toBe(false);
		expect(objects.size).toBe(1);
		ok(await pay(B, B, png(5)));
		expect(objects.size).toBe(2);
		// 8. saiu da divisão: a cota de B vira reembolso e mantém o comprovante; devolver o reembolso apaga o objeto
		ok(await repo.updateParticipants(db, g, e.id, OWNER, [OWNER, A, BEN], "this", undefined, mem));
		const refund = (await raw()).find((s) => s.uid === B)!;
		expect(refund).toMatchObject({ amountCents: 0, paidCents: expect.any(Number), method: "self" });
		expect(objects.has(refund.receipt!.key)).toBe(true);
		expect((await pay(B, B, png(6))).status).toBe("no_share");
		ok(await repo.setSharePaid(db, g, e.id, OWNER, B, "paid", undefined, mem));
		expect((await raw()).some((s) => s.uid === B)).toBe(false);
		expect(objects.has(refund.receipt!.key)).toBe(false);
		// 9. os saldos continuam batendo com a referência
		const docs = await rawDocs(g);
		for (const u of [OWNER, A, B]) {
			const ref = shares.balanceOf(docs, u);
			const got = (await groupsRepo.listGroups(db, u)).find((x) => x.id === g)!;
			expect([got.toReceiveCents, got.toPayCents]).toEqual([ref.toReceiveCents, ref.toPayCents]);
		}
	}, 120_000);

	it("pagar tudo de uma vez: contas a pagar por destinatário, lote com um comprovante, desfazer com objeto compartilhado, falha parcial", async () => {
		const payments = await import("@/lib/payments/repo");
		const objects = new Map<string, Uint8Array>();
		let onPut: (() => Promise<void>) | null = null;
		const mem = {
			put: async (k: string, b: Uint8Array) => {
				objects.set(k, b);
				await onPut?.();
			},
			get: async () => null,
			delete: async (ks: string[]) => void ks.forEach((k) => objects.delete(k)),
		} as never;
		const png = { name: "pix.png", contentType: "image/png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]) };
		const g1 = await newGroup("lote1", [OWNER, A, B]);
		const g2 = await newGroup("lote2", [OWNER, A, B]);
		const added = await groupsRepo.addManagedMember(db, g1, OWNER, { name: "Benjamim", managedBy: A });
		if (added.status !== "ok") throw new Error("addManagedMember: " + added.status);
		const BEN = added.uid;
		const mkExp = async (g: string, by: string, amountCents: number, participantUids: string[], dueDate?: string) =>
			ok(await repo.createExpense(db, mem, { groupId: g, uid: by, input: { description: "Lote " + amountCents, amountCents, date: "2026-11-10", participantUids, ...(dueDate ? { dueDate } : {}) }, files: [] })).expense;
		const e1 = await mkExp(g1, OWNER, 3000, [OWNER, A, BEN]); // A e Benjamim devem 1000 ao dono
		await mkExp(g1, OWNER, 3000, [OWNER, A, BEN], "2099-01-01"); // ainda não venceu: fora
		const e3 = await mkExp(g2, OWNER, 2000, [OWNER, A]); // A deve 1000 ao dono (outro grupo, mesma chave)
		const e4 = await mkExp(g2, B, 1500, [B, A]); // A deve 750 a B (outro destinatário)
		const it_ = (g: string, e: string, u: string) => ({ groupId: g, expenseId: e, shareUid: u });
		const rawShare = async (g: string, e: string, u: string) => (await rawDocs(g)).find((d) => d._id.toHexString() === e)!.shares.find((s) => s.uid === u)!;

		// 1. contas a pagar da A: dono (3000, 3 itens, incl. Benjamim) e B (750); a que vence em 2099 fica de fora
		const pay = await payments.getPayables(db, A);
		// o usuário A aparece em outros grupos "__it__" de testes anteriores: só olha os desta rodada
		const mineRecipients = pay.recipients
			.map((r) => ({ ...r, items: r.items.filter((i) => [g1, g2].includes(i.groupId)) }))
			.filter((r) => r.items.length > 0)
			.map((r) => ({ ...r, totalCents: r.items.reduce((t, i) => t + i.dueCents, 0) }))
			.sort((x, y) => y.totalCents - x.totalCents);
		expect(mineRecipients.map((r) => [r.payee.uid, r.totalCents, r.items.length])).toEqual([[OWNER, 3000, 3], [B, 750, 1]]);
		expect(mineRecipients[0].items.map((i) => [i.shareUid, i.isYou, i.dueCents]).sort()).toEqual([[A, true, 1000], [A, true, 1000], [BEN, false, 1000]].sort());
		expect(mineRecipients[0].id).not.toBe(mineRecipients[1].id);
		expect(JSON.stringify(mineRecipients)).not.toContain("receipts/");

		// 2. destinatários misturados: recusado sem mudar nada nem subir arquivo
		const mixed = await payments.payBatch(db, mem, { uid: A, items: [it_(g1, e1.id, A), it_(g2, e4.id, A)], file: png });
		expect(mixed).toMatchObject({ status: "invalid", field: "items", error: "Escolha contas de um mesmo destinatário." });
		expect(objects.size).toBe(0);
		expect((await rawShare(g1, e1.id, A)).paidCents).toBe(0);
		expect((await payments.payBatch(db, mem, { uid: C, items: [it_(g1, e1.id, A)] })).status).toBe("no_group");
		expect((await payments.payBatch(db, mem, { uid: B, items: [it_(g2, e3.id, A)] })).status).toBe("forbidden");

		// 3. lote cheio com um comprovante: as duas cotas apontam para o MESMO objeto
		const full = await payments.payBatch(db, mem, { uid: A, items: [it_(g1, e1.id, A), it_(g2, e3.id, A)], file: png });
		if (full.status !== "ok") throw new Error(full.status);
		expect(full).toMatchObject({ totalPaidCents: 2000, hasReceipt: true, failed: [] });
		const s1 = await rawShare(g1, e1.id, A);
		const s3 = await rawShare(g2, e3.id, A);
		expect(s1.receipt!.key).toBe(s3.receipt!.key);
		expect(s1.receipt!.key.startsWith(`receipts/batch/${full.batchId}/`)).toBe(true);
		expect([s1, s3]).toEqual([expect.objectContaining({ method: "self", markedBy: A, paidCents: 1000, batch: { id: full.batchId, totalCents: 2000, count: 2 } }), expect.objectContaining({ method: "self", paidCents: 1000, batch: { id: full.batchId, totalCents: 2000, count: 2 } })]);
		expect(objects.size).toBe(1);
		const seen = ok((await repo.getExpenseDetail(db, g1, e1.id, A)) as never) as unknown as { expense: import("./repo").ExpenseDetail };
		expect(seen.expense.shares.find((s) => s.uid === A)).toMatchObject({ batch: { totalCents: 2000, count: 2 }, receipt: { name: "pix.png" } });
		expect(JSON.stringify(seen)).not.toContain("receipts/");
		expect(await repo.getReceiptRef(db, g2, e3.id, A, OWNER)).toMatchObject({ status: "ok", key: s1.receipt!.key });
		expect((await payments.getPayables(db, A)).recipients.some((r) => r.items.some((i) => i.groupId === g2 && i.expenseId === e3.id))).toBe(false);

		// 4. dono desfaz uma: o objeto fica (a outra ainda referencia); desfaz a última: o objeto some
		ok(await repo.setSharePaid(db, g1, e1.id, OWNER, A, "pending", undefined, mem));
		expect(objects.has(s1.receipt!.key)).toBe(true);
		expect(await repo.getReceiptRef(db, g2, e3.id, A, A)).toMatchObject({ status: "ok", key: s1.receipt!.key });
		ok(await repo.setSharePaid(db, g2, e3.id, OWNER, A, "pending", undefined, mem));
		expect(objects.size).toBe(0);
		expect(await rawShare(g1, e1.id, A)).toEqual({ uid: A, amountCents: 1000, paidCents: 0 });

		// 5. falha parcial: no meio do envio o dono quita a cota do outro grupo; as demais seguem
		onPut = async () => void ok(await repo.setSharePaid(db, g2, e3.id, OWNER, A, "paid", undefined, mem));
		const partial = await payments.payBatch(db, mem, { uid: A, items: [it_(g1, e1.id, A), it_(g1, e1.id, BEN), it_(g2, e3.id, A)], file: png });
		onPut = null;
		if (partial.status !== "ok") throw new Error(partial.status);
		expect(partial.paid.map((p) => p.shareUid)).toEqual([A, BEN]);
		expect(partial.failed).toEqual([{ ...it_(g2, e3.id, A), reason: "already_paid" }]);
		expect(partial.totalPaidCents).toBe(2000);
		for (const u of [A, BEN]) {
			expect(await rawShare(g1, e1.id, u)).toMatchObject({ method: "self", markedBy: A, batch: { id: partial.batchId, totalCents: 2000, count: 2 } });
		}
		expect((await rawShare(g2, e3.id, A)).method).toBe("manual");
		expect(objects.size).toBe(1);
		// 6. cota única de um lote troca o comprovante: sai do lote, a outra segue com o do lote
		ok(await repo.markSelfPaid(db, mem, { groupId: g1, eid: e1.id, uid: A, targetUid: A, file: { ...png, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]) } }));
		expect(await rawShare(g1, e1.id, A)).not.toHaveProperty("batch");
		expect((await rawShare(g1, e1.id, BEN)).batch).toBeDefined();
		expect(objects.size).toBe(2);
		// 7. tudo mudou: nada pago, 409 no HTTP (all_failed) e nenhum objeto novo fica
		expect((await payments.payBatch(db, mem, { uid: A, items: [it_(g1, e1.id, A)], file: png })).status).toBe("invalid"); // já paga: recusada antes
		expect(objects.size).toBe(2);
		// 8. apagar o que sobrou: deleteExpense solta só o que ninguém mais referencia
		expect((await repo.deleteExpense(db, mem, g1, e1.id, OWNER)).status).toBe("has_payment");
	}, 120_000);

	it("a receber: devedores entre grupos, quem recebe é pessoa que o dono cuida, cota paga fora, e o total confere com o resumo", async () => {
		const payments = await import("@/lib/payments/repo");
		const g1 = await newGroup("rec1", [OWNER, A, B]);
		const g2 = await newGroup("rec2", [OWNER, A]);
		const added = await groupsRepo.addManagedMember(db, g1, OWNER, { name: "Benjamim", managedBy: OWNER, pixKey: { type: "cpf", key: "52998224725" } as never });
		if (added.status !== "ok") throw new Error("addManagedMember: " + added.status);
		const BEN = added.uid;
		const mk = async (g: string, by: string, description: string, amountCents: number, participantUids: string[], extra: Record<string, unknown> = {}, paidByUid?: string) =>
			ok(await repo.createExpense(db, store, { groupId: g, uid: by, input: { description, amountCents, date: "2026-11-10", participantUids, ...extra, ...(paidByUid ? { paidByUid } : {}) } as never, files: [] })).expense;
		await mk(g1, OWNER, "Mercado", 3000, [OWNER, A, B]); // A e B devem 1000
		await mk(g2, OWNER, "Aluguel", 2000, [OWNER, A], { dueDate: "2099-01-01" }); // A deve 1000, ainda não venceu
		await mk(g1, OWNER, "Remédio do Benjamim", 1500, [BEN, B], {}, BEN); // B deve 750 a Benjamim (o dono cuida dele)
		const paid = await mk(g1, OWNER, "Já paga", 2000, [OWNER, B]);
		ok(await repo.setSharePaid(db, g1, paid.id, OWNER, B, "paid"));

		const full = await payments.getReceivables(db, OWNER);
		// OWNER aparece em grupos "__it__" de outros testes desta rodada: só olha os destes dois grupos
		const mine = full.debtors
			.map((d) => ({ ...d, items: d.items.filter((i) => [g1, g2].includes(i.groupId)) }))
			.filter((d) => d.items.length > 0)
			.map((d) => ({ ...d, totalCents: d.items.reduce((t, i) => t + i.dueCents, 0) }))
			.sort((x, y) => y.totalCents - x.totalCents);
		expect(mine.map((d) => [d.uid, d.totalCents, d.items.length, d.kind])).toEqual([
			[A, 2000, 2, "user"],
			[B, 1750, 2, "user"],
		]);
		expect(mine[0].items.map((i) => [i.groupId, i.description, i.payeeIsYou]).sort()).toEqual([[g1, "Mercado", true], [g2, "Aluguel", true]].sort());
		const forBen = mine[1].items.find((i) => i.description === "Remédio do Benjamim")!;
		expect([forBen.payeeIsYou, forBen.payeeName, forBen.dueCents]).toEqual([false, "Benjamim", 750]);
		expect(mine[1].items.some((i) => i.description === "Já paga")).toBe(false);
		expect(JSON.stringify(full)).not.toContain("example.invalid");
		expect(JSON.stringify(full)).not.toContain("52998224725");

		// o total confere com o "a receber" do início: o que é do dono + o que é de quem ele cuida (cartão à parte)
		const docs = [...(await rawDocs(g1)), ...(await rawDocs(g2))];
		const ref = shares.balanceOf(docs, OWNER);
		const refBen = shares.balanceOf(docs, BEN);
		const all = mine.flatMap((d) => d.items);
		expect(all.reduce((t, i) => t + i.dueCents, 0)).toBe(ref.toReceiveCents + refBen.toReceiveCents);
		expect(all.filter((i) => i.dueDate === null).reduce((t, i) => t + i.dueCents, 0)).toBe(ref.toReceiveNowCents + refBen.toReceiveNowCents);
		expect(all.filter((i) => !i.payeeIsYou).reduce((t, i) => t + i.dueCents, 0)).toBe(refBen.toReceiveCents);
		const summary = await repo.getSummary(db, OWNER);
		expect(summary.managed.find((m) => m.uid === BEN)!.toReceiveCents).toBe(refBen.toReceiveCents);
		// quem deve vê a mesma cota como "a pagar", não como "a receber"
		expect((await payments.getReceivables(db, A)).debtors.flatMap((d) => d.items).filter((i) => [g1, g2].includes(i.groupId))).toEqual([]);
	}, 120_000);

	it("Quero ajudar (membro e pessoa sem login) e relatório de contribuições", async () => {
		const reports = await import("@/lib/reports/repo");
		const compute = await import("@/lib/reports/compute");
		const periods = await import("@/lib/reports/period");
		const g = await newGroup("ajudar", [OWNER, A, B]);
		const VO = `m_${RUN}`;
		await groupsRepo.groupsCollection(db).updateOne(
			{ _id: new ObjectId(g) },
			{ $push: { members: { uid: VO, role: "member" as const, joinedAt: new Date(), kind: "managed" as const, name: "Vó IT", managedBy: B } } } as never,
		);
		const mk = async (uid_: string, description: string, amountCents: number, date: string, participantUids: string[]) =>
			ok(await repo.createExpense(db, store, { groupId: g, uid: uid_, input: { description, amountCents, date, participantUids }, files: [] })).expense;

		// 1. dono lança sozinho; os outros veem que podem ajudar
		const e = await mk(OWNER, "Luz", 3000, "2026-11-10", [OWNER]);
		expect(e).toMatchObject({ ownerAlone: true, canHelp: false, helpShareCents: null });
		const asA = ok(await repo.getExpenseDetail(db, g, e.id, A) as never) as unknown as { expense: import("./repo").ExpenseDetail };
		expect(asA.expense).toMatchObject({ ownerAlone: true, canHelp: true, helpAsUids: [], helpShareCents: 1500 });
		const asB = ok(await repo.getExpenseDetail(db, g, e.id, B) as never) as unknown as { expense: import("./repo").ExpenseDetail };
		expect(asB.expense).toMatchObject({ canHelp: true, helpAsUids: [VO], helpShareCents: 1500 });
		expect((await repo.listExpenses(db, g, A))![0]).toMatchObject({ canHelp: true, ownerAlone: true, helpShareCents: 1500 });

		// 2. o dono não ajuda; A ajuda: 1500 / 1500, marcado
		expect(await repo.helpExpense(db, g, e.id, OWNER)).toEqual({ status: "payer" });
		let d = ok(await repo.helpExpense(db, g, e.id, A)).expense;
		expect(d.shares.map((x) => [x.uid, x.amountCents, x.helped])).toEqual([[OWNER, 1500, false], [A, 1500, true]]);
		expect(d).toMatchObject({ ownerAlone: false, canHelp: false });
		expect(await repo.helpExpense(db, g, e.id, A)).toEqual({ status: "already", name: null });
		const raw = (await rawDocs(g)).find((x) => x._id.toHexString() === e.id)!;
		expect(raw.version).toBe(1);
		expect(raw.shares.find((x) => x.uid === A)).toMatchObject({ helped: true });
		expect(raw.shares.find((x) => x.uid === A)!.helpedAt).toBeInstanceOf(Date);

		// 3. A paga; B ajuda pela Vó (forUid) -> 1000 cada, A passa a ter reembolso de 500; quem não cuida dela é rejeitado
		ok(await repo.setSharePaid(db, g, e.id, OWNER, A, "paid"));
		expect(await repo.helpExpense(db, g, e.id, A, VO)).toMatchObject({ status: "invalid", field: "forUid" });
		expect(await repo.helpExpense(db, g, e.id, B, A)).toMatchObject({ status: "invalid", field: "forUid" });
		d = ok(await repo.helpExpense(db, g, e.id, B, VO)).expense;
		const by = (u: string) => d.shares.find((x) => x.uid === u);
		expect(d.shares).toHaveLength(3);
		expect([OWNER, A, VO].map((u) => [by(u)!.amountCents, by(u)!.paidCents, by(u)!.helped])).toEqual([[1000, 0, false], [1000, 1500, true], [1000, 0, true]]);
		expect(d.shares.find((x) => x.uid === A)).toMatchObject({ status: "refund", refundCents: 500 });
		expect(await repo.helpExpense(db, g, e.id, B, VO)).toEqual({ status: "already", name: "Vó IT" });

		// 4. B entra como ele mesmo: 750 cada
		d = ok(await repo.helpExpense(db, g, e.id, B)).expense;
		expect(d.shares.map((x) => x.amountCents).sort()).toEqual([750, 750, 750, 750]);
		expect(d.shares.reduce((t, x) => t + x.amountCents, 0)).toBe(3000);

		// 5. dono tira B da divisão: some cota e marca de B (sem pagamento); a de A segue marcada
		d = ok(await repo.updateParticipants(db, g, e.id, OWNER, [OWNER, A, VO])).expense;
		expect(d.shares.some((x) => x.uid === B)).toBe(false);
		expect(d.shares.filter((x) => x.helped).map((x) => x.uid).sort()).toEqual([A, VO].sort());

		// 6. outras despesas: A lança sozinho em outubro; o dono lança com Vó e um parcial
		await mk(A, "Gás", 1200, "2026-10-05", [A]);
		const e3 = await mk(OWNER, "Mercado", 2000, "2026-11-20", [OWNER, B, VO]);
		ok(await repo.setSharePaid(db, g, e3.id, OWNER, B, "paid"));
		// ex-membro: A sai do grupo depois de ter gasto
		const docsAll = await rawDocs(g);

		// 7. relatório == referência pura, para all e para o mês
		for (const [period, include] of [["all", () => true], ["month:2026-11", (x: { date: string }) => periods.inPeriod(x.date, { kind: "month", month: "2026-11" })]] as const) {
			const res = await reports.getGroupReport(db, g, OWNER, periods.parsePeriod(period)!);
			const rep = ok(res as never) as unknown as { report: import("@/lib/reports/repo").Report };
			const ref = compute.referenceFacet(docsAll.filter(include));
			expect(rep.report.totalCents).toBe(ref.totals[0].total);
			expect(rep.report.expenseCount).toBe(ref.totals[0].count);
			expect(rep.report.months).toEqual(ref.months.map((m) => ({ month: m._id, totalCents: m.total })));
			for (const p of rep.report.people) {
				const r = ref.people.find((x) => x._id === p.uid);
				expect([p.advancedCents, p.shareCents, p.bornCents, p.pendingCents, p.owedBackCents, p.helpedCount, p.expensesPaidCount]).toEqual(
					r ? [r.advanced, r.share, r.born, r.pending, r.owedBack, r.helped, r.paidCount] : [0, 0, 0, 0, 0, 0, 0],
				);
			}
			expect(rep.report.people.reduce((t, p) => t + p.bornCents, 0)).toBe(rep.report.totalCents);
			expect(rep.report.people.map((p) => p.uid).sort()).toEqual([OWNER, A, B, VO].sort());
			expect(rep.report.people.find((p) => p.uid === VO)).toMatchObject({ kind: "managed", name: "Vó IT", youManage: false });
			expect(rep.report.people.find((p) => p.uid === A)!.helpedCount).toBe(1);
			expect(JSON.stringify(rep.report)).not.toMatch(/example\.invalid|pixKey/);
		}
		const nov = ok((await reports.getGroupReport(db, g, B, { kind: "month", month: "2026-11" })) as never) as unknown as { report: import("@/lib/reports/repo").Report };
		expect(nov.report.totalCents).toBe(5000);
		expect(nov.report.people.find((p) => p.uid === VO)).toMatchObject({ youManage: true });

		// 8. ex-membro: remove A do grupo; continua no relatório, sem estar mais no grupo
		await groupsRepo.groupsCollection(db).updateOne({ _id: new ObjectId(g) }, { $pull: { members: { uid: A } } } as never);
		const after = ok((await reports.getGroupReport(db, g, OWNER, { kind: "all" })) as never) as unknown as { report: import("@/lib/reports/repo").Report };
		expect(after.report.people.find((p) => p.uid === A)).toMatchObject({ stillMember: false, expensesPaidCount: 1, helpedCount: 1 });
		expect(after.report.people.reduce((t, p) => t + p.bornCents, 0)).toBe(after.report.totalCents);
		expect(after.report.people).toHaveLength(4);
	}, 120_000);

	it("resumo, a pagar e a receber restritos a um grupo: só o que é dele, somam o total e batem com 'Seus grupos'", async () => {
		const payments = await import("@/lib/payments/repo");
		const g1 = await newGroup("esc1", [OWNER, A]);
		const g2 = await newGroup("esc2", [OWNER, A]);
		const added = await groupsRepo.addManagedMember(db, g1, OWNER, { name: "Benjamim", managedBy: A });
		if (added.status !== "ok") throw new Error("addManagedMember: " + added.status);
		const BEN = added.uid;
		const mk = async (g: string, by: string, description: string, amountCents: number, participantUids: string[]) =>
			ok(await repo.createExpense(db, store, { groupId: g, uid: by, input: { description, amountCents, date: "2026-11-10", participantUids }, files: [] })).expense;
		await mk(g1, OWNER, "Mercado", 3000, [OWNER, A, BEN]); // A e Benjamim devem 1000 ao dono
		await mk(g1, A, "Gás", 1200, [A, OWNER]); // o dono deve 600 a A
		await mk(g2, OWNER, "Aluguel", 2000, [OWNER, A]); // A deve 1000 ao dono
		const FIELDS = ["toReceiveCents", "toPayCents", "toReceiveNowCents", "toPayNowCents", "overdueToPayCents"] as const;

		for (const u of [OWNER, A]) {
			const mine = await groupsRepo.listGroups(db, u);
			// 1. o resumo de cada grupo bate com o saldo do grupo em "Seus grupos"
			for (const g of mine) {
				const scoped = (await repo.getSummary(db, u, undefined, g.id))!;
				for (const k of FIELDS) expect(scoped[k], `${k} de ${u.slice(-1)} em ${g.id}`).toBe(g[k]);
				expect(scoped.managed.every((m) => m.groupId === g.id)).toBe(true);
			}
			// 2. a soma dos grupos é o resumo do início, inclusive as pessoas que cuida
			const global = await repo.getSummary(db, u);
			const parts = await Promise.all(mine.map(async (g) => (await repo.getSummary(db, u, undefined, g.id))!));
			for (const k of FIELDS) expect(parts.reduce((t, p) => t + p[k], 0), k).toBe(global[k]);
			expect(parts.flatMap((p) => p.managed).map((m) => `${m.groupId}:${m.uid}`).sort()).toEqual(global.managed.map((m) => `${m.groupId}:${m.uid}`).sort());
			// 3. a pagar e a receber: cada grupo só tem itens dele e a união é o total
			const allPay = await payments.getPayables(db, u);
			const payKeys = allPay.recipients.flatMap((r) => r.items).map((i) => `${i.groupId}:${i.expenseId}:${i.shareUid}`).sort();
			const scopedPay = await Promise.all(mine.map(async (g) => ({ g, p: (await payments.getPayables(db, u, undefined, g.id))! })));
			for (const { g, p } of scopedPay) expect(p.recipients.flatMap((r) => r.items).every((i) => i.groupId === g.id)).toBe(true);
			expect(scopedPay.flatMap(({ p }) => p.recipients.flatMap((r) => r.items)).map((i) => `${i.groupId}:${i.expenseId}:${i.shareUid}`).sort()).toEqual(payKeys);
			const allRec = await payments.getReceivables(db, u);
			const recKeys = allRec.debtors.flatMap((d) => d.items.map((i) => `${i.groupId}:${i.expenseId}:${d.uid}`)).sort();
			const scopedRec = await Promise.all(mine.map(async (g) => ({ g, r: (await payments.getReceivables(db, u, undefined, g.id))! })));
			for (const { g, r } of scopedRec) expect(r.debtors.flatMap((d) => d.items).every((i) => i.groupId === g.id)).toBe(true);
			expect(scopedRec.flatMap(({ r }) => r.debtors.flatMap((d) => d.items.map((i) => `${i.groupId}:${i.expenseId}:${d.uid}`))).sort()).toEqual(recKeys);
			expect(scopedRec.reduce((t, { r }) => t + r.totalCents, 0)).toBe(allRec.totalCents);
			expect(scopedRec.reduce((t, { r }) => t + r.nowCents, 0)).toBe(allRec.nowCents);
		}

		// 4. valores concretos de A: no grupo 1 deve 1000 (e Benjamim 1000) e tem 600 a receber; no grupo 2 deve 1000
		const a1 = (await repo.getSummary(db, A, undefined, g1))!;
		expect(a1).toMatchObject({ toPayCents: 1000, toReceiveCents: 600 });
		expect(a1.managed).toEqual([expect.objectContaining({ uid: BEN, groupId: g1, toPayCents: 1000 })]);
		expect(await repo.getSummary(db, A, undefined, g2)).toMatchObject({ toPayCents: 1000, toReceiveCents: 0, managed: [] });
		const p1 = (await payments.getPayables(db, A, undefined, g1))!;
		expect(p1.recipients.flatMap((r) => r.items).reduce((t, i) => t + i.dueCents, 0)).toBe(2000);
		expect((await payments.getReceivables(db, A, undefined, g2))!.debtors).toEqual([]);

		// 5. grupo de que a pessoa não faz parte, inexistente ou id inválido: null (a rota responde 404)
		const outsider = uid("fora");
		expect(await repo.getSummary(db, outsider, undefined, g1)).toBeNull();
		expect(await payments.getPayables(db, outsider, undefined, g1)).toBeNull();
		expect(await payments.getReceivables(db, outsider, undefined, g1)).toBeNull();
		expect(await repo.getSummary(db, A, undefined, new ObjectId().toHexString())).toBeNull();
		expect(await payments.getPayables(db, A, undefined, "lixo")).toBeNull();
	}, 120_000);
});
