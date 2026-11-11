/**
 * Integração das despesas fixas contra o MongoDB REAL de desenvolvimento. Só roda com IT_MONGO=1
 * (node --env-file=.env.local scripts/it-expenses.mjs). Dados "__it__*" descartáveis, apagados no final.
 * Exige os índices de `npm run db:indexes` (o índice único é o que impede mês duplicado).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";

const ENABLED = process.env.IT_MONGO === "1" && Boolean(process.env.MONGODB_URI);
const RUN = `__it__${Date.now().toString(36)}r`;
const uid = (n: string) => `${RUN}_${n}`;
const [OWNER, A, NOPIX] = ["owner", "a", "nopix"].map(uid);

describe.skipIf(!ENABLED)("integração: despesas fixas no MongoDB real", () => {
	let client: MongoClient;
	let db: Db;
	const groupIds: ObjectId[] = [];
	let groupsRepo: typeof import("@/lib/groups/repo");
	let expensesRepo: typeof import("@/lib/expenses/repo");
	let mat: typeof import("./materialize");
	let recRepo: typeof import("./repo");
	let recs: ReturnType<typeof import("./collection").recurrencesCollection>;
	const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

	async function newGroup(name: string, members: string[]): Promise<ObjectId> {
		const g = await groupsRepo.createGroup(db, members[0], `__it__ ${RUN} ${name}`);
		const _id = new ObjectId(g.id);
		groupIds.push(_id);
		await groupsRepo.groupsCollection(db).updateOne(
			{ _id },
			{ $push: { members: { $each: members.slice(1).map((u) => ({ uid: u, role: "member" as const, joinedAt: new Date() })) } } },
		);
		return _id;
	}
	const expensesOf = (g: ObjectId, rid?: string) =>
		expensesRepo.expensesCollection(db).find({ groupId: g, ...(rid ? { "recurrence.id": rid } : { recurrence: { $exists: true } }) }).sort({ "recurrence.period": 1 }).toArray();
	const periodsOf = async (g: ObjectId, rid: string) => (await expensesOf(g, rid)).map((e) => e.recurrence!.period);
	async function make(g: ObjectId, over: Record<string, unknown> = {}) {
		const input = { description: "Aluguel", amountCents: 3000, dayOfMonth: 31, participantMode: "all" as const, participantUids: [], startPeriod: "2026-09", ...over };
		const r = await recRepo.createRecurrence(db, { groupId: g.toHexString(), uid: OWNER, input: input as never, now: at("2026-09-02") });
		expect(r.status).toBe("ok");
		return (r as Extract<typeof r, { status: "ok" }>).recurrence.id;
	}

	beforeAll(async () => {
		client = new MongoClient(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 10_000 });
		await client.connect();
		db = client.db(process.env.MONGODB_DB || "despesas");
		groupsRepo = await import("@/lib/groups/repo");
		expensesRepo = await import("@/lib/expenses/repo");
		mat = await import("./materialize");
		recRepo = await import("./repo");
		recs = (await import("./collection")).recurrencesCollection(db);
		await db.collection<{ _id: string }>("users").insertMany(
			[OWNER, A, NOPIX].map((u) => ({
				_id: u,
				name: u.slice(-5),
				email: `${u}@example.invalid`,
				...(u === NOPIX ? {} : { pixKey: { type: "email", key: `${u}@example.invalid` } }),
			})) as never,
		);
	});

	afterAll(async () => {
		if (!client) return;
		try {
			await expensesRepo.expensesCollection(db).deleteMany({ groupId: { $in: groupIds } });
			await recs.deleteMany({ groupId: { $in: groupIds } });
			await groupsRepo.groupsCollection(db).deleteMany({ _id: { $in: groupIds }, name: { $regex: "^__it__" } });
			await db.collection("users").deleteMany({ _id: { $regex: `^${RUN}_` } } as never);
		} finally {
			await client.close();
		}
	});

	it("tem os índices novos", async () => {
		const names = (await db.collection("expenses").indexes()).map((i) => i.name);
		expect(names).toContain("recurrence_period_unique");
		expect((await db.collection("recurrences").indexes()).map((i) => i.name)).toContain("group_active_next");
	});

	it("gera o mês ao ler; duas leituras simultâneas geram uma só despesa; apagar não traz de volta", async () => {
		const g = await newGroup("conc", [OWNER, A]);
		const rid = await make(g, { startPeriod: "2026-11" });
		// criada em set/2026 com início em nov: nada ainda em outubro
		expect(await mat.materializeRecurrences(db, [g], at("2026-10-15"))).toBe(0);
		expect(await expensesOf(g, rid)).toHaveLength(0);

		const results = await Promise.all([mat.materializeRecurrences(db, [g], at("2026-11-02")), mat.materializeRecurrences(db, [g], at("2026-11-02")), mat.materializeRecurrences(db, [g], at("2026-11-02"))]);
		expect(results.reduce((a, b) => a + b, 0)).toBe(1);
		const [e] = await expensesOf(g, rid);
		expect(e).toMatchObject({ date: "2026-11-01", dueDate: "2026-11-30", paidBy: OWNER, version: 0, attachments: [] });
		expect(e.shares.map((s) => [s.uid, s.amountCents, s.paidCents])).toEqual([[OWNER, 1500, 0], [A, 1500, 0]]);
		expect(e.pix).toMatchObject({ key: `${OWNER}@example.invalid` });

		// a leitura de verdade (lista) também materializa e mostra a marca
		const list = (await expensesRepo.listExpenses(db, g.toHexString(), A, at("2026-11-03")))!;
		expect(list).toHaveLength(1);
		expect(list[0].recurrence).toEqual({ id: rid, period: "2026-11" });

		// apagar a despesa do mês não a recria
		await expensesRepo.expensesCollection(db).deleteOne({ _id: e._id });
		expect(await mat.materializeRecurrences(db, [g], at("2026-11-20"))).toBe(0);
		expect(await expensesOf(g, rid)).toHaveLength(0);
		expect((await recs.findOne({ _id: new ObjectId(rid) }))!.nextPeriod).toBe("2026-12");
	});

	it("recupera 3 meses de uma vez (dia 31 limitado) e o índice único barra duplicata", async () => {
		const g = await newGroup("catchup", [OWNER, A]);
		const rid = await make(g, { startPeriod: "2026-09" });
		// o mês de início (set) já nasceu na criação; os outros dois vêm na leitura de nov, sem duplicar
		expect(await periodsOf(g, rid)).toEqual(["2026-09"]);
		const [x, y] = await Promise.all([mat.materializeRecurrences(db, [g], at("2026-11-11")), mat.materializeRecurrences(db, [g], at("2026-11-11"))]);
		expect(x + y).toBe(2);
		expect(await periodsOf(g, rid)).toEqual(["2026-09", "2026-10", "2026-11"]);
		expect((await expensesOf(g, rid)).map((e) => e.dueDate)).toEqual(["2026-09-30", "2026-10-31", "2026-11-30"]);
		// segunda trava: inserir o mesmo mês direto falha por chave duplicada
		const doc = { ...(await expensesOf(g, rid))[0], _id: new ObjectId() };
		await expect(expensesRepo.expensesCollection(db).insertOne(doc)).rejects.toMatchObject({ code: 11000 });
	});

	it("endPeriod encerra; encerrar manualmente para de gerar e mantém o que existe", async () => {
		const g = await newGroup("end", [OWNER, A]);
		const rid = await make(g, { startPeriod: "2026-09", endPeriod: "2026-10" });
		expect(await mat.materializeRecurrences(db, [g], at("2026-12-01"))).toBe(1);
		expect(await periodsOf(g, rid)).toEqual(["2026-09", "2026-10"]);
		expect(await recs.findOne({ _id: new ObjectId(rid) })).toMatchObject({ active: false });
		expect(await recRepo.listRecurrences(db, g.toHexString(), OWNER)).toEqual([]);

		const rid2 = await make(g, { description: "Internet", startPeriod: "2026-09" });
		expect(await periodsOf(g, rid2)).toEqual(["2026-09"]);
		expect(await recRepo.endRecurrence(db, { groupId: g.toHexString(), rid: rid2, uid: OWNER })).toEqual({ status: "ok" });
		expect(await recRepo.endRecurrence(db, { groupId: g.toHexString(), rid: rid2, uid: OWNER })).toEqual({ status: "ok" });
		expect(await mat.materializeRecurrences(db, [g], at("2026-12-01"))).toBe(0);
		expect(await periodsOf(g, rid2)).toEqual(["2026-09"]);
	});

	it("quem paga sem Pix é pulado sem avançar; gera quando cadastra a chave; quem saiu do grupo desativa", async () => {
		const g = await newGroup("pix", [OWNER, NOPIX]);
		const rid = new ObjectId();
		await recs.insertOne({ _id: rid, groupId: g, createdBy: NOPIX, paidBy: NOPIX, description: "Luz", amountCents: 2000, dayOfMonth: 10, participantMode: "alone", participantUids: [], startPeriod: "2026-11", nextPeriod: "2026-11", active: true, createdAt: new Date(), updatedAt: new Date() });
		expect(await mat.materializeRecurrences(db, [g], at("2026-11-11"))).toBe(0);
		expect(await recs.findOne({ _id: rid })).toMatchObject({ active: true, nextPeriod: "2026-11" });

		await db.collection<{ _id: string }>("users").updateOne({ _id: NOPIX }, { $set: { pixKey: { type: "email", key: "novo@example.invalid" } } } as never);
		expect(await mat.materializeRecurrences(db, [g], at("2026-11-12"))).toBe(1);
		const [e] = await expensesOf(g, rid.toHexString());
		expect(e).toMatchObject({ dueDate: "2026-11-10", pix: { key: "novo@example.invalid" } });
		expect(e.shares).toEqual([{ uid: NOPIX, amountCents: 2000, paidCents: 0 }]);

		// quem paga sai do grupo: desativa, sem gerar
		await groupsRepo.groupsCollection(db).updateOne({ _id: g }, { $pull: { members: { uid: NOPIX } } } as never);
		expect(await mat.materializeRecurrences(db, [g], at("2026-12-12"))).toBe(0);
		expect(await recs.findOne({ _id: rid })).toMatchObject({ active: false });
		// a leitura do resumo e do relatório não quebra
		await expensesRepo.getSummary(db, OWNER, at("2026-12-12"));
	});
});
