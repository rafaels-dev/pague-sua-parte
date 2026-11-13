import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { AttachmentStore } from "@/lib/storage/attachments";
import { closePlan } from "./close";
import { CLOSING_STALE_MS, type PlanDoc } from "./collection";
import { fakeDb } from "./test-db";

const NOW = new Date("2026-11-12T15:00:00Z");
const PID = "507f1f77bcf86cd799439011";
const store = {} as AttachmentStore;

function plan(over: Partial<PlanDoc> = {}): PlanDoc {
	return {
		_id: new ObjectId(PID),
		name: "Hotel",
		totalCents: 90000,
		createdBy: "cri",
		status: "open",
		participants: [{ uid: "cri", joinedAt: NOW }, { uid: "ana", joinedAt: NOW }, { uid: "bia", joinedAt: NOW }, { uid: "dan", joinedAt: NOW }, { uid: "eva", joinedAt: NOW }],
		guests: [{ id: "pg_1", name: "Benjamim", addedBy: "bia" }, { id: "pg_2", name: "Tio Zé", addedBy: "dan" }],
		responses: [
			{ who: "cri", going: true, by: "cri", at: NOW },
			{ who: "ana", going: true, by: "ana", at: NOW },
			{ who: "pg_1", going: true, by: "bia", at: NOW },
			{ who: "bia", going: true, by: "bia", at: NOW },
			{ who: "dan", going: false, by: "dan", at: NOW },
			{ who: "pg_2", going: true, by: "dan", at: NOW },
			// eva não respondeu
		],
		attachments: [],
		invite: null,
		version: 3,
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	};
}
const body = (over: object = {}) => ({ groupName: "Viagem", participantIds: ["cri", "ana", "pg_1"], paidBy: "cri", date: "2026-11-12", ...over });
type F = ReturnType<typeof fakeDb>;
const okExpense = (f: F) =>
	vi.fn(async (_d, _s, a) => {
		f.data.expenses.push({ _id: new ObjectId(a.expenseId), planId: a.planId, groupId: a.groupId });
		return { status: "ok", expense: { id: a.expenseId }, newExpense: { groupId: a.groupId, expenseId: a.expenseId } } as never;
	});
const deps = (f: F, over: Record<string, unknown> = {}) => ({ createExpense: okExpense(f), hasPix: async () => true, ...over }) as never;

describe("closePlan", () => {
	it("cria grupo e despesa com os códigos sorteados na reserva e marca o plano como done", async () => {
		const f = fakeDb();
		f.data.plans.push(plan() as never);
		const d = deps(f);
		const r = await closePlan(f.db, store, "cri", PID, body(), d, NOW);
		expect(r.status).toBe("ok");
		const group = f.data.groups[0] as { _id: ObjectId; name: string; createdBy: string; members: { uid: string; role: string; kind?: string; managedBy?: string; name?: string }[] };
		expect(group).toMatchObject({ name: "Viagem", createdBy: "cri" });
		expect(group.members.find((m) => m.uid === "cri")?.role).toBe("admin");
		const managed = group.members.find((m) => m.kind === "managed")!;
		expect(managed).toMatchObject({ name: "Benjamim", managedBy: "bia", role: "member" });
		expect(managed.uid.startsWith("m_")).toBe(true);
		expect(group.members.find((m) => m.uid === "bia")).toBeTruthy(); // responsável entra, sem parte
		const args = (d as { createExpense: ReturnType<typeof okExpense> }).createExpense.mock.calls[0][2];
		expect(args).toMatchObject({ uid: "cri", planId: PID, files: [], input: { description: "Hotel", amountCents: 90000, participantUids: ["cri", "ana", managed.uid] } });
		expect(args.input.paidByUid).toBeUndefined();
		const saved = f.data.plans[0];
		expect(saved).toMatchObject({ status: "done", groupName: "Viagem", groupId: group._id.toHexString(), expenseId: args.expenseId });
		expect(saved.closing).toBeUndefined();
		expect(r.status === "ok" && r.notChosenGoing.sort()).toEqual(["bia", "pg_2"]);
	});

	describe("só entra quem disse Vou (S1)", () => {
		const closeWith = async (b: object, over: Record<string, unknown> = {}) => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const d = deps(f, over);
			const r = await closePlan(f.db, store, "cri", PID, body(b), d, NOW);
			return { r, f, d: d as unknown as { createExpense: ReturnType<typeof vi.fn>; hasPix: ReturnType<typeof vi.fn> } };
		};
		const untouched = ({ f, d }: Awaited<ReturnType<typeof closeWith>>) => {
			expect(d.createExpense).not.toHaveBeenCalled();
			expect(f.data.groups).toHaveLength(0);
			expect(f.data.plans[0]).toMatchObject({ status: "open", version: 3 });
			expect(f.data.plans[0].closing).toBeUndefined();
		};
		it("quem disse Não vou não entra na divisão", async () => {
			const x = await closeWith({ participantIds: ["cri", "dan"] });
			expect(x.r).toMatchObject({ status: "invalid", field: "participantIds" });
			untouched(x);
		});
		it("quem não respondeu não entra na divisão", async () => {
			const x = await closeWith({ participantIds: ["cri", "eva"] });
			expect(x.r).toMatchObject({ status: "invalid", field: "participantIds" });
			untouched(x);
		});
		it("pessoa sem celular que não disse Vou não entra (nem a que disse Não vou)", async () => {
			const f = fakeDb();
			f.data.plans.push(plan({ responses: plan().responses.map((r) => (r.who === "pg_1" ? { ...r, going: false } : r)) }) as never);
			const r = await closePlan(f.db, store, "cri", PID, body({ participantIds: ["cri", "pg_1"] }), deps(f), NOW);
			expect(r).toMatchObject({ status: "invalid", field: "participantIds" });
		});
		it("quem está acima do limite mas disse Vou pode entrar (opção B)", async () => {
			const f = fakeDb();
			f.data.plans.push(plan({ responses: plan().responses.map((r) => (r.who === "ana" ? { ...r, limitCents: 100 } : r)) }) as never);
			const r = await closePlan(f.db, store, "cri", PID, body(), deps(f), NOW);
			expect(r.status).toBe("ok");
		});
		it("pessoa sem celular não pode ser quem pagou", async () => {
			const x = await closeWith({ paidBy: "pg_1" });
			expect(x.r).toMatchObject({ status: "invalid", field: "paidBy" });
			untouched(x);
		});
		it("quem pagou precisa estar entre quem divide", async () => {
			const x = await closeWith({ paidBy: "bia" });
			expect(x.r).toMatchObject({ status: "invalid", field: "paidBy" });
			untouched(x);
		});
		it("o criador pagando sem chave Pix: recusa ANTES de reservar ou criar qualquer coisa", async () => {
			const x = await closeWith({}, { hasPix: async () => false });
			expect(x.r).toEqual({ status: "no_pix" });
			untouched(x);
		});
		it("outro participante pagando: a chave Pix dele não é exigida na hora", async () => {
			const x = await closeWith({ paidBy: "ana" }, { hasPix: async () => false });
			expect(x.r.status).toBe("ok");
			expect(x.d.createExpense.mock.calls[0][2].input.paidByUid).toBe("ana");
		});
	});

	it("só o criador fecha; quem não participa não vê o plano", async () => {
		const f = fakeDb();
		f.data.plans.push(plan() as never);
		const d = deps(f);
		expect((await closePlan(f.db, store, "ana", PID, body(), d, NOW)).status).toBe("forbidden");
		expect((await closePlan(f.db, store, "intruso", PID, body(), d, NOW)).status).toBe("no_plan");
		expect(f.data.groups).toHaveLength(0);
		expect(f.data.plans[0].status).toBe("open");
	});
	it("entrada inválida não cria nada", async () => {
		const f = fakeDb();
		f.data.plans.push(plan() as never);
		const d = deps(f);
		expect(await closePlan(f.db, store, "cri", PID, body({ groupName: "" }), d, NOW)).toMatchObject({ status: "invalid", field: "groupName" });
		expect(await closePlan(f.db, store, "cri", PID, body({ participantIds: ["cri", "estranho"] }), d, NOW)).toMatchObject({ status: "invalid", field: "participantIds" });
		expect(f.data.groups).toHaveLength(0);
	});
	it("plano que não está aberto não fecha de novo", async () => {
		const f = fakeDb();
		f.data.plans.push(plan({ status: "done" }) as never);
		expect((await closePlan(f.db, store, "cri", PID, body(), deps(f), NOW)).status).toBe("not_open");
		f.data.plans[0].status = "cancelled";
		expect((await closePlan(f.db, store, "cri", PID, body(), deps(f), NOW)).status).toBe("not_open");
	});
	it("duas tentativas ao mesmo tempo: só uma cria", async () => {
		const f = fakeDb();
		f.data.plans.push(plan() as never);
		const d = deps(f);
		const [a, b] = await Promise.all([closePlan(f.db, store, "cri", PID, body(), d, NOW), closePlan(f.db, store, "cri", PID, body(), d, NOW)]);
		const st = [a.status, b.status];
		expect(st.filter((x) => x === "ok")).toHaveLength(1);
		expect(st.filter((x) => x === "conflict" || x === "not_open")).toHaveLength(1);
		expect(f.data.groups).toHaveLength(1);
		expect(f.data.expenses).toHaveLength(1);
	});
	it("despesa recusada (invalid): desfaz o grupo e volta para open", async () => {
		const f = fakeDb();
		f.data.plans.push(plan() as never);
		const createExpense = vi.fn(async () => ({ status: "no_pix", name: "Ana" }) as never);
		const r = await closePlan(f.db, store, "cri", PID, body({ paidBy: "ana" }), deps(f, { createExpense }), NOW);
		expect(r).toEqual({ status: "no_pix", name: "Ana" });
		expect(f.data.groups).toHaveLength(0);
		expect(f.data.plans[0]).toMatchObject({ status: "open" });
		expect(f.data.plans[0].closing).toBeUndefined();
	});
	it("erro inesperado: apaga o que a tentativa criou por código, volta a open, erro sobe, dá para tentar de novo", async () => {
		const f = fakeDb();
		f.data.plans.push(plan() as never);
		f.data.expenses.push({ _id: new ObjectId(), planId: "outra-coisa" }); // de outro plano: nunca é tocada
		const createExpense = vi.fn(async (_d, _s, a) => {
			f.data.expenses.push({ _id: new ObjectId(a.expenseId), planId: a.planId });
			throw new Error("banco caiu");
		});
		await expect(closePlan(f.db, store, "cri", PID, body(), deps(f, { createExpense }), NOW)).rejects.toThrow("banco caiu");
		expect(f.data.groups).toHaveLength(0);
		expect(f.data.expenses).toHaveLength(1);
		expect(f.data.plans[0].status).toBe("open");
		expect((await closePlan(f.db, store, "cri", PID, body(), deps(f), NOW)).status).toBe("ok");
	});

	describe("só o grupo (createExpense: false)", () => {
		const groupOnly = (over: object = {}) => ({ groupName: "Sítio", participantIds: ["cri", "ana", "pg_1"], createExpense: false, ...over });
		it("cria só o grupo: sem despesa, sem pagador, sem exigir Pix, plano done sem expenseId", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const d = deps(f, { hasPix: vi.fn(async () => false) });
			const r = await closePlan(f.db, store, "cri", PID, groupOnly(), d, NOW);
			expect(r.status).toBe("ok");
			const x = d as unknown as { createExpense: ReturnType<typeof vi.fn>; hasPix: ReturnType<typeof vi.fn> };
			expect(x.createExpense).not.toHaveBeenCalled();
			expect(x.hasPix).not.toHaveBeenCalled();
			expect(f.data.expenses).toHaveLength(0);
			const group = f.data.groups[0] as { members: { uid: string; role: string; kind?: string; managedBy?: string }[] };
			expect(group.members.find((m) => m.uid === "cri")?.role).toBe("admin");
			expect(group.members.find((m) => m.kind === "managed")).toMatchObject({ managedBy: "bia" });
			expect(group.members.find((m) => m.uid === "bia")).toBeTruthy();
			expect(f.data.plans[0]).toMatchObject({ status: "done", groupName: "Sítio" });
			expect("expenseId" in f.data.plans[0]).toBe(false);
			expect(f.data.plans[0].closing).toBeUndefined();
			expect(r.status === "ok" && r.expenseId).toBeUndefined();
			expect(r.status === "ok" && r.newExpense).toBeUndefined();
			expect(r.status === "ok" && r.doc.expenseId).toBeUndefined();
			expect(r.status === "ok" && r.notChosenGoing.sort()).toEqual(["bia", "pg_2"]);
		});
		it("pagador, data e vencimento mandados nesse modo são ignorados (inclusive pagador inválido)", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const d = deps(f);
			const r = await closePlan(f.db, store, "cri", PID, groupOnly({ paidBy: "pg_1", date: "2030-01-01" }), d, NOW);
			expect(r.status).toBe("ok");
			expect((d as unknown as { createExpense: ReturnType<typeof vi.fn> }).createExpense).not.toHaveBeenCalled();
		});
		it("continua valendo: só entra quem disse Vou", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const d = deps(f);
			expect(await closePlan(f.db, store, "cri", PID, groupOnly({ participantIds: ["cri", "dan"] }), d, NOW)).toMatchObject({ status: "invalid", field: "participantIds" });
			expect(await closePlan(f.db, store, "cri", PID, groupOnly({ participantIds: ["cri", "eva"] }), d, NOW)).toMatchObject({ status: "invalid", field: "participantIds" });
			expect(await closePlan(f.db, store, "ana", PID, groupOnly(), d, NOW)).toMatchObject({ status: "forbidden" });
			expect(f.data.groups).toHaveLength(0);
			expect(f.data.plans[0]).toMatchObject({ status: "open", version: 3 });
		});
		it("createExpense inválido: 422 e nada criado; ausente e true seguem criando a despesa", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const d = deps(f);
			expect(await closePlan(f.db, store, "cri", PID, body({ createExpense: "false" }), d, NOW)).toMatchObject({ status: "invalid", field: "createExpense" });
			expect(f.data.groups).toHaveLength(0);
			expect((await closePlan(f.db, store, "cri", PID, body({ createExpense: true }), d, NOW)).status).toBe("ok");
			expect(f.data.expenses).toHaveLength(1);
			expect(f.data.plans[0]).toHaveProperty("expenseId");
		});
		it("falha ao gravar o done: apaga só o grupo da tentativa, volta a open e dá para tentar de novo", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			f.data.groups.push({ _id: new ObjectId(), name: "De outro plano" });
			f.data.expenses.push({ _id: new ObjectId(), planId: "outra-coisa" });
			const orig = (f.db as unknown as { collection: (n: string) => Record<string, (...a: unknown[]) => Promise<unknown>> }).collection;
			let fail = true;
			(f.db as unknown as { collection: unknown }).collection = (n: string) => {
				const c = orig(n);
				if (n !== "plans") return c;
				return {
					...c,
					updateOne: async (q: unknown, u: { $set?: { status?: string } }) => {
						if (fail && u.$set?.status === "done") throw new Error("banco caiu");
						return c.updateOne(q, u);
					},
				};
			};
			await expect(closePlan(f.db, store, "cri", PID, groupOnly(), deps(f), NOW)).rejects.toThrow("banco caiu");
			expect(f.data.groups.map((g) => g.name)).toEqual(["De outro plano"]);
			expect(f.data.expenses).toHaveLength(1);
			expect(f.data.plans[0].status).toBe("open");
			fail = false;
			expect((await closePlan(f.db, store, "cri", PID, groupOnly(), deps(f), NOW)).status).toBe("ok");
		});
		it("fechamento preso sem despesa: a recuperação apaga só o grupo sobrado e a nova tentativa segue", async () => {
			const f = fakeDb();
			const stale = new Date(NOW.getTime() - CLOSING_STALE_MS - 1000);
			const gid = new ObjectId();
			f.data.plans.push(plan({ status: "closing", closing: { at: stale, attemptId: "velha", groupId: gid.toHexString() } }) as never);
			f.data.groups.push({ _id: gid, name: "Sobrou" });
			f.data.expenses.push({ _id: new ObjectId(), planId: "outra-coisa" });
			const r = await closePlan(f.db, store, "cri", PID, groupOnly(), deps(f), NOW);
			expect(r.status).toBe("ok");
			expect(f.data.groups.map((g) => g.name)).toEqual(["Sítio"]);
			expect(f.data.expenses).toHaveLength(1);
		});
		it("resposta do done perdida: devolve sucesso sem apagar o grupo", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const orig = (f.db as unknown as { collection: (n: string) => Record<string, (...a: unknown[]) => Promise<unknown>> }).collection;
			(f.db as unknown as { collection: unknown }).collection = (n: string) => {
				const c = orig(n);
				if (n !== "plans") return c;
				return {
					...c,
					updateOne: async (q: unknown, u: { $set?: { status?: string } }) => {
						const r = await c.updateOne(q, u);
						if (u.$set?.status === "done") throw new Error("rede caiu");
						return r;
					},
				};
			};
			const r = await closePlan(f.db, store, "cri", PID, groupOnly(), deps(f), NOW);
			expect(r.status).toBe("ok");
			expect(f.data.groups).toHaveLength(1);
			expect(f.data.plans[0]).toMatchObject({ status: "done" });
		});
	});

	describe("resposta perdida na gravação do done (B)", () => {
		const lossy = (f: F, loseDone: boolean) => {
			const orig = (f.db as unknown as { collection: (n: string) => Record<string, (...a: unknown[]) => Promise<unknown>> }).collection;
			(f.db as unknown as { collection: unknown }).collection = (n: string) => {
				const c = orig(n);
				if (n !== "plans") return c;
				return {
					...c,
					updateOne: async (q: unknown, u: { $set?: { status?: string } }) => {
						const r = await c.updateOne(q, u);
						if (loseDone && u.$set?.status === "done") throw new Error("rede caiu");
						return r;
					},
				};
			};
		};
		it("o done chegou ao banco mas a resposta se perdeu: não apaga nada e devolve sucesso", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			lossy(f, true);
			const r = await closePlan(f.db, store, "cri", PID, body(), deps(f), NOW);
			expect(r.status).toBe("ok");
			expect(f.data.groups).toHaveLength(1);
			expect(f.data.expenses).toHaveLength(1);
			expect(f.data.plans[0]).toMatchObject({ status: "done", groupName: "Viagem" });
			expect(r.status === "ok" && r.newExpense).toBeTruthy(); // o aviso de despesa nova continua valendo
		});
		it("erro antes do done: desfaz como antes e o erro sobe", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const createExpense = vi.fn(async (_d, _s, a) => {
				f.data.expenses.push({ _id: new ObjectId(a.expenseId), planId: a.planId });
				throw new Error("banco caiu");
			});
			await expect(closePlan(f.db, store, "cri", PID, body(), deps(f, { createExpense }), NOW)).rejects.toThrow("banco caiu");
			expect(f.data.groups).toHaveLength(0);
			expect(f.data.expenses).toHaveLength(0);
			expect(f.data.plans[0].status).toBe("open");
		});
		it("plano done por OUTRA tentativa não livra esta de apagar o que criou", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const createExpense = vi.fn(async (_d, _s, a) => {
				f.data.expenses.push({ _id: new ObjectId(a.expenseId), planId: a.planId });
				// enquanto esta tentativa trabalha, outra (já recuperada) concluiu o plano
				Object.assign(f.data.plans[0], { status: "done", closedAttemptId: "outra", groupId: "g-outra", expenseId: "e-outra" });
				delete f.data.plans[0].closing;
				throw new Error("falhou");
			});
			await expect(closePlan(f.db, store, "cri", PID, body(), deps(f, { createExpense }), NOW)).rejects.toThrow("falhou");
			expect(f.data.groups).toHaveLength(0); // o grupo desta tentativa foi apagado
			expect(f.data.expenses).toHaveLength(0);
			expect(f.data.plans[0]).toMatchObject({ status: "done", closedAttemptId: "outra" });
		});
	});

	describe("fechamento preso", () => {
		it("na próxima tentativa, a recuperação desfaz o que sobrou e a nova tentativa segue", async () => {
			const f = fakeDb();
			const stale = new Date(NOW.getTime() - CLOSING_STALE_MS - 1000);
			const gid = new ObjectId();
			const eid = new ObjectId();
			f.data.plans.push(plan({ status: "closing", closing: { at: stale, attemptId: "velha", groupId: gid.toHexString(), expenseId: eid.toHexString() } }) as never);
			f.data.groups.push({ _id: gid, name: "Sobrou" });
			f.data.expenses.push({ _id: eid, planId: PID });
			const r = await closePlan(f.db, store, "cri", PID, body(), deps(f), NOW);
			expect(r.status).toBe("ok");
			expect(f.data.groups.map((g) => g.name)).toEqual(["Viagem"]);
			expect(f.data.expenses).toHaveLength(1);
			expect(String(f.data.expenses[0]._id)).not.toBe(eid.toHexString());
		});
		it("fechamento recente em andamento não é atropelado", async () => {
			const f = fakeDb();
			f.data.plans.push(plan({ status: "closing", closing: { at: NOW, attemptId: "viva", groupId: new ObjectId().toHexString(), expenseId: new ObjectId().toHexString() } }) as never);
			const d = deps(f);
			expect((await closePlan(f.db, store, "cri", PID, body(), d, NOW)).status).toBe("not_open");
			expect((d as unknown as { createExpense: ReturnType<typeof vi.fn> }).createExpense).not.toHaveBeenCalled();
		});
		it("tentativa A lenta, B recupera e conclui: A não conclui, apaga só o que criou e B fica intacta", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			let release!: () => void;
			const gate = new Promise<void>((r) => (release = r));
			const slow = vi.fn(async (_d, _s, a) => {
				f.data.expenses.push({ _id: new ObjectId(a.expenseId), planId: a.planId, groupId: a.groupId });
				await gate; // A travada depois de criar grupo e despesa
				return { status: "ok", expense: { id: a.expenseId }, newExpense: undefined } as never;
			});
			const aPromise = closePlan(f.db, store, "cri", PID, body(), deps(f, { createExpense: slow }), NOW);
			await vi.waitFor(() => expect(slow).toHaveBeenCalled());
			expect(f.data.plans[0].status).toBe("closing");
			const aGroup = String(f.data.groups[0]._id);

			// Muito depois, B lê (recupera) e fecha.
			const later = new Date(NOW.getTime() + CLOSING_STALE_MS + 60_000);
			const b = await closePlan(f.db, store, "cri", PID, body({ groupName: "Do B" }), deps(f), later);
			expect(b.status).toBe("ok");
			expect(f.data.groups.map((g) => g.name)).toEqual(["Do B"]);
			expect(f.data.groups.some((g) => String(g._id) === aGroup)).toBe(false);

			release();
			expect((await aPromise).status).toBe("conflict");
			// o que é do B continua; o plano continua done com o grupo do B
			expect(f.data.groups.map((g) => g.name)).toEqual(["Do B"]);
			expect(f.data.expenses).toHaveLength(1);
			expect(f.data.plans[0]).toMatchObject({ status: "done", groupName: "Do B" });
		});
		it("se A conclui antes da recuperação, a recuperação não apaga nada", async () => {
			const f = fakeDb();
			f.data.plans.push(plan() as never);
			const r = await closePlan(f.db, store, "cri", PID, body(), deps(f), NOW);
			expect(r.status).toBe("ok");
			// uma leitura tardia (com `closing` já limpo) não mexe em nada
			const { findPlanFor } = await import("./repo");
			const later = new Date(NOW.getTime() + CLOSING_STALE_MS * 3);
			expect((await findPlanFor(f.db, PID, "cri", later))?.status).toBe("done");
			expect(f.data.groups).toHaveLength(1);
			expect(f.data.expenses).toHaveLength(1);
		});
	});
});
