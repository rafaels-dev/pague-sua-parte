import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { ExpenseDoc } from "@/lib/expenses/repo";
import { buildPayables, recipientId, recipientKey } from "./payables";

const G1 = new ObjectId("507f1f77bcf86cd799439011");
const G2 = new ObjectId("507f1f77bcf86cd799439012");
const m = (uid: string, extra: Record<string, unknown> = {}) => ({ uid, role: "member" as const, joinedAt: new Date(), ...extra });
const groups = [
	{ _id: G1, name: "Casa", members: [m("me"), m("ana"), m("bia"), m("m_ben", { kind: "managed", managedBy: "me", name: "Benjamim" }), m("m_other", { kind: "managed", managedBy: "bia", name: "Outro" })] },
	{ _id: G2, name: "Viagem", members: [m("me"), m("ana")] },
];
const people = new Map([
	["me", { _id: "me", name: "Eu" }],
	["ana", { _id: "ana", name: "Ana", picture: "p" }],
	["bia", { _id: "bia", name: "Bia" }],
]);
let n = 0;
const exp = (over: Record<string, unknown>): ExpenseDoc =>
	({
		_id: new ObjectId(String(++n).padStart(24, "0")),
		groupId: G1,
		createdBy: "ana",
		paidBy: "ana",
		description: "Item",
		amountCents: 2000,
		date: "2026-11-01",
		pix: { type: "email", key: "ana@x.com", payeeName: "Ana" },
		shares: [
			{ uid: "ana", amountCents: 1000, paidCents: 0 },
			{ uid: "me", amountCents: 1000, paidCents: 0 },
		],
		attachments: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		...over,
	}) as ExpenseDoc;
const TODAY = "2026-11-15";
const run = (expenses: ExpenseDoc[], max?: number) => buildPayables({ uid: "me", today: TODAY, groups, expenses, people, max });

describe("buildPayables", () => {
	it("agrupa por quem pagou + chave Pix e ordena destinatários por total decrescente", () => {
		const r = run([
			exp({ description: "A" }),
			exp({ description: "B", groupId: G2 }),
			exp({ description: "C", pix: { type: "cpf", key: "52998224725", payeeName: "Ana" } }),
			exp({ description: "D", paidBy: "bia", createdBy: "bia", shares: [{ uid: "bia", amountCents: 100, paidCents: 0 }, { uid: "me", amountCents: 5000, paidCents: 0 }], pix: { type: "email", key: "bia@x.com", payeeName: "Bia" } }),
		]);
		expect(r.truncated).toBe(false);
		expect(r.recipients.map((x) => [x.payee.name, x.pix.key, x.totalCents, x.items.length])).toEqual([
			["Bia", "bia@x.com", 5000, 1],
			["Ana", "ana@x.com", 2000, 2],
			["Ana", "52998224725", 1000, 1],
		]);
		expect(r.recipients[1].items.map((i) => i.groupName).sort()).toEqual(["Casa", "Viagem"]);
		expect(r.recipients[1].payee).toEqual({ uid: "ana", name: "Ana", picture: "p", kind: "user" });
	});
	it("inclui só pendentes de quem o usuário age (ele e quem cuida); ignora de outros, pagas, reembolso e a do pagador", () => {
		const r = run([
			exp({
				shares: [
					{ uid: "ana", amountCents: 700, paidCents: 0 },
					{ uid: "me", amountCents: 700, paidCents: 200 },
					{ uid: "m_ben", amountCents: 700, paidCents: 0 },
					{ uid: "m_other", amountCents: 700, paidCents: 0 },
					{ uid: "bia", amountCents: 700, paidCents: 0 },
				],
			}),
			exp({ description: "paga", shares: [{ uid: "ana", amountCents: 1, paidCents: 0 }, { uid: "me", amountCents: 1000, paidCents: 1000 }] }),
			exp({ description: "reembolso", shares: [{ uid: "ana", amountCents: 1, paidCents: 0 }, { uid: "me", amountCents: 0, paidCents: 300 }] }),
		]);
		const items = r.recipients[0].items;
		expect(items.map((i) => [i.shareUid, i.shareName, i.isYou, i.dueCents])).toEqual([
			["m_ben", "Benjamim", false, 700],
			["me", "Eu", true, 500],
		]);
		expect(r.recipients[0].totalCents).toBe(1200);
	});
	it("só 'a pagar agora': sem vencimento ou até o fim do mês de hoje; atrasada marcada", () => {
		const r = run([
			exp({ description: "sem data" }),
			exp({ description: "atrasada", dueDate: "2026-11-02" }),
			exp({ description: "fim do mês", dueDate: "2026-11-30" }),
			exp({ description: "mês que vem", dueDate: "2026-12-01" }),
			exp({ description: "parcela", dueDate: "2026-10-30", installment: { seriesId: "s", number: 2, count: 3 }, recurrence: { id: "r", period: "2026-10" } }),
		]);
		const items = r.recipients[0].items;
		expect(items.map((i) => i.description)).toEqual(["parcela", "atrasada", "fim do mês", "sem data"]);
		expect(items.map((i) => i.overdue)).toEqual([true, true, false, false]);
		expect(items[0]).toMatchObject({ installment: { number: 2, count: 3 }, recurrence: true, dueDate: "2026-10-30" });
		expect(items[3]).toMatchObject({ installment: null, recurrence: false, dueDate: null });
	});
	it("limita a 200 itens (primeiros por vencimento) e avisa com truncated", () => {
		const many = Array.from({ length: 5 }, (_, i) => exp({ description: `d${i}`, dueDate: `2026-11-0${i + 1}` }));
		const r = run(many, 3);
		expect(r.truncated).toBe(true);
		expect(r.recipients[0].items.map((i) => i.description)).toEqual(["d0", "d1", "d2"]);
		expect(r.recipients[0].totalCents).toBe(3000);
	});
	it("id do destinatário é estável, depende de pagador+tipo+chave e não expõe a chave", () => {
		const a = exp({});
		expect(recipientId(a)).toBe(recipientId(exp({ description: "outra" })));
		expect(recipientId(a)).not.toBe(recipientId(exp({ pix: { type: "email", key: "outra@x.com", payeeName: "Ana" } })));
		expect(recipientId(a)).not.toBe(recipientId(exp({ paidBy: "bia" })));
		expect(recipientId(a)).toMatch(/^r_[0-9a-f]{24}$/);
		expect(recipientId(a)).not.toContain("ana");
		expect(recipientKey(a)).toBe(recipientKey(exp({})));
		expect(JSON.stringify(run([exp({})]).recipients[0].id)).not.toContain("ana@x.com");
	});
	it("sem nada a pagar: lista vazia", () => {
		expect(run([])).toEqual({ recipients: [], truncated: false });
	});
});

describe("buildPayables: devoluções", () => {
	// "me" pagou a despesa e Ana pagou a mais (1500 por uma cota de 1000): me devolve 500 para Ana, no Pix de Ana.
	const refundExp = (over: Record<string, unknown> = {}) =>
		exp({
			paidBy: "me",
			createdBy: "me",
			description: "Mercado",
			pix: { type: "email", key: "me@x.com", payeeName: "Eu" },
			shares: [{ uid: "me", amountCents: 1000, paidCents: 0 }, { uid: "ana", amountCents: 1000, paidCents: 1500 }],
			...over,
		});
	const pix = new Map([[`${G1.toHexString()}:ana`, { type: "email", key: "ana-atual@x.com", payeeName: "Ana" }]]);
	const run2 = (expenses: ExpenseDoc[], refundExpenses: ExpenseDoc[], refundPixes = pix) =>
		buildPayables({ uid: "me", today: TODAY, groups, expenses, refundExpenses, refundPixes, people });

	it("a devolução vira item 'refund' do destinatário (quem recebe de volta), sem vencimento", () => {
		const r = run2([], [refundExp()]);
		expect(r.recipients).toHaveLength(1);
		expect(r.recipients[0]).toMatchObject({ payee: { uid: "ana", name: "Ana" }, pix: { key: "ana-atual@x.com" }, totalCents: 500 });
		expect(r.recipients[0].items[0]).toMatchObject({ kind: "refund", shareUid: "ana", dueCents: 500, dueDate: null, overdue: false, isYou: true, description: "Mercado" });
	});
	it("junta no MESMO destinatário (um Pix) a parte a pagar e a devolução para a mesma pessoa e chave", () => {
		const owes = exp({ description: "Luz", pix: { type: "email", key: "ana-atual@x.com", payeeName: "Ana" } }); // me deve 1000 a Ana
		const r = run2([owes], [refundExp()]);
		expect(r.recipients).toHaveLength(1);
		expect(r.recipients[0].totalCents).toBe(1500);
		expect(r.recipients[0].items.map((i) => i.kind).sort()).toEqual(["refund", "share"]);
	});
	it("sem chave Pix de quem recebe, ou quando a devolução seria para si mesmo/quem cuida, não entra; só quem paga a despesa devolve", () => {
		expect(run2([], [refundExp()], new Map()).recipients).toEqual([]);
		expect(run2([], [refundExp({ shares: [{ uid: "me", amountCents: 1000, paidCents: 0 }, { uid: "m_ben", amountCents: 1000, paidCents: 1500 }] })], new Map([[`${G1.toHexString()}:m_ben`, { type: "email", key: "b@x.com", payeeName: "Ben" }]])).recipients).toEqual([]);
		expect(run2([], [refundExp({ paidBy: "ana", createdBy: "ana" })]).recipients).toEqual([]);
	});
	it("devolução já feita ou parcela paga na medida não entra", () => {
		expect(run2([], [refundExp({ shares: [{ uid: "me", amountCents: 1000, paidCents: 0 }, { uid: "ana", amountCents: 1000, paidCents: 1000, refund: { cents: 500, at: new Date(), markedBy: "me" } }] })]).recipients).toEqual([]);
	});
});
