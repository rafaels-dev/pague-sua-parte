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
		expect(await repo.getSummary(db, OWNER)).toEqual({ toReceiveCents: 1000, toPayCents: 0 });

		// 4. C entra depois: A passa a ter reembolso (750 de cota, pagou 1000)
		d = ok(await repo.updateParticipants(db, g1, eid, OWNER, [OWNER, A, B, C])).expense;
		expect(d.shares.find((s) => s.uid === A)).toMatchObject({ amountCents: 750, status: "refund", refundCents: 250 });
		expect(d.shares.reduce((t, s) => t + s.amountCents, 0)).toBe(3000);
		expect(await repo.getSummary(db, OWNER)).toEqual({ toReceiveCents: 1500, toPayCents: 250 });
		expect(await repo.getSummary(db, A)).toEqual({ toReceiveCents: 250, toPayCents: 0 });
		expect(await repo.getSummary(db, B)).toEqual({ toReceiveCents: 0, toPayCents: 750 });

		// 5. segundo grupo: despesa de A, dono deve 600 -> soma dos grupos
		const e2 = ok(await repo.createExpense(db, store, { groupId: g2, uid: A, input: { description: "Luz", amountCents: 1200, date: "2026-11-10", participantUids: [A, OWNER] }, files: [] })).expense;
		const sOwner = await repo.getSummary(db, OWNER);
		expect(sOwner).toEqual({ toReceiveCents: 1500, toPayCents: 850 });
		const list = await groupsRepo.listGroups(db, OWNER);
		const mine = list.filter((g) => groupIds.some((x) => x.toHexString() === g.id));
		expect(Object.fromEntries(mine.map((g) => [g.id, [g.toReceiveCents, g.toPayCents]]))).toEqual({ [g1]: [1500, 250], [g2]: [0, 600] });
		// a conta de saldos do usuário de teste só vê os grupos dele; confere contra a referência em JS
		for (const u of [OWNER, A, B, C]) {
			const docs = [...(await rawDocs(g1)), ...(await rawDocs(g2))];
			expect(await repo.getSummary(db, u)).toEqual(shares.balanceOf(docs, u));
		}

		// 6. A sai da divisão: cota 0 e reembolso integral (1000), linha por último
		d = ok(await repo.updateParticipants(db, g1, eid, OWNER, [OWNER, B, C])).expense;
		expect(d.shares.map((s) => s.uid)).toEqual([OWNER, B, C, A].sort((x, y) => (x === OWNER ? -1 : y === OWNER ? 1 : x === A ? 1 : y === A ? -1 : x.localeCompare(y))));
		expect(d.shares.at(-1)).toMatchObject({ uid: A, amountCents: 0, paidCents: 1000, status: "refund", refundCents: 1000, participates: false });
		expect(d.participantUids.sort()).toEqual([OWNER, B, C].sort());
		expect(await repo.getSummary(db, OWNER)).toEqual({ toReceiveCents: 2000, toPayCents: 1000 + 600 });

		// 7. despesa com pagamento não pode ser apagada
		expect((await repo.deleteExpense(db, store, g1, eid, OWNER)).status).toBe("has_payment");

		// 8. dono devolve o reembolso: a linha de A some
		d = ok(await repo.setSharePaid(db, g1, eid, OWNER, A, "paid")).expense;
		expect(d.shares.some((s) => s.uid === A)).toBe(false);
		expect(await repo.getSummary(db, OWNER)).toEqual({ toReceiveCents: 2000, toPayCents: 600 });
		expect(await repo.getSummary(db, A)).toEqual({ toReceiveCents: 600, toPayCents: 0 });

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
});
