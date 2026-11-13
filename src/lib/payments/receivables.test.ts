import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { ExpenseDoc } from "@/lib/expenses/repo";
import { buildReceivables } from "./receivables";

const G1 = new ObjectId("507f1f77bcf86cd799439011");
const G2 = new ObjectId("507f1f77bcf86cd799439012");
const m = (uid: string, extra: Record<string, unknown> = {}) => ({ uid, role: "member" as const, joinedAt: new Date(), ...extra });
const groups = [
	{ _id: G1, name: "Casa", members: [m("me"), m("ana"), m("bia"), m("m_ben", { kind: "managed", managedBy: "me", name: "Benjamim" }), m("m_tia", { kind: "managed", managedBy: "bia", name: "Tia" })] },
	{ _id: G2, name: "Viagem", members: [m("me"), m("ana")] },
];
const people = new Map([
	["me", { _id: "me", name: "Eu" }],
	["ana", { _id: "ana", name: "Ana", picture: "p", email: "ana@x.com" }],
	["bia", { _id: "bia", name: "Bia" }],
]);
let n = 0;
const exp = (over: Record<string, unknown>): ExpenseDoc =>
	({
		_id: new ObjectId(String(++n).padStart(24, "0")),
		groupId: G1,
		createdBy: "me",
		paidBy: "me",
		description: "Item",
		amountCents: 2000,
		date: "2026-11-01",
		pix: { type: "email", key: "me@x.com", payeeName: "Eu" },
		shares: [
			{ uid: "me", amountCents: 1000, paidCents: 0 },
			{ uid: "ana", amountCents: 1000, paidCents: 0 },
		],
		attachments: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		...over,
	}) as ExpenseDoc;
const TODAY = "2026-11-15";
const run = (expenses: ExpenseDoc[], max?: number) => buildReceivables({ uid: "me", today: TODAY, groups, expenses, people, max });

describe("buildReceivables: pagamento parcial", () => {
	it("o devedor aparece com o que FALTA e quanto já pagou; o total e o 'agora' somam só o que falta", () => {
		const r = run([exp({ shares: [{ uid: "me", amountCents: 1000, paidCents: 0 }, { uid: "ana", amountCents: 1000, paidCents: 400 }] })]);
		expect(r.debtors[0].items[0]).toMatchObject({ dueCents: 600, paidCents: 400 });
		expect(r.totalCents).toBe(600);
		expect(r.nowCents).toBe(600);
		expect(r.debtors[0].totalCents).toBe(600);
	});
	it("parte quitada só por parciais some da lista", () => {
		const r = run([exp({ shares: [{ uid: "me", amountCents: 1000, paidCents: 0 }, { uid: "ana", amountCents: 1000, paidCents: 1000, parts: [{ id: "p", cents: 1000, at: new Date(), markedBy: "ana", method: "self" }] }] })]);
		expect(r.debtors).toEqual([]);
	});
});

describe("buildReceivables", () => {
	it("agrupa por devedor entre grupos e ordena por total decrescente", () => {
		const r = run([
			exp({ description: "A" }),
			exp({ description: "B", groupId: G2 }),
			exp({ description: "C", shares: [{ uid: "me", amountCents: 1, paidCents: 0 }, { uid: "bia", amountCents: 5000, paidCents: 0 }] }),
		]);
		expect(r.debtors.map((d) => [d.name, d.totalCents, d.items.length])).toEqual([
			["Bia", 5000, 1],
			["Ana", 2000, 2],
		]);
		expect(r.debtors[1]).toMatchObject({ uid: "ana", picture: "p", kind: "user", managedByName: null, youManage: false });
		expect(r.debtors[1].items.map((i) => i.groupName).sort()).toEqual(["Casa", "Viagem"]);
		expect(r.totalCents).toBe(7000);
		expect(r.truncated).toBe(false);
	});
	it("só pendentes; ignora pagas, reembolso, a cota do pagador e despesas pagas por outros", () => {
		const r = run([
			exp({ shares: [{ uid: "me", amountCents: 500, paidCents: 0 }, { uid: "ana", amountCents: 700, paidCents: 200 }, { uid: "bia", amountCents: 300, paidCents: 300 }] }),
			exp({ description: "reembolso", shares: [{ uid: "me", amountCents: 1, paidCents: 0 }, { uid: "ana", amountCents: 0, paidCents: 300 }] }),
			exp({ description: "do outro", paidBy: "ana", shares: [{ uid: "ana", amountCents: 1, paidCents: 0 }, { uid: "me", amountCents: 900, paidCents: 0 }, { uid: "bia", amountCents: 900, paidCents: 0 }] }),
		]);
		expect(r.debtors.map((d) => [d.uid, d.totalCents])).toEqual([["ana", 500]]);
	});
	it("pessoa sem celular que você cuida como quem recebe: entra, com o nome dela; devedor sem celular traz quem cuida", () => {
		const r = run([
			exp({ description: "Remédio", paidBy: "m_ben", shares: [{ uid: "m_ben", amountCents: 1, paidCents: 0 }, { uid: "ana", amountCents: 3000, paidCents: 0 }, { uid: "me", amountCents: 900, paidCents: 0 }] }),
			exp({ description: "Sua", shares: [{ uid: "me", amountCents: 1, paidCents: 0 }, { uid: "m_tia", amountCents: 1200, paidCents: 0 }] }),
			exp({ description: "De fora", paidBy: "m_tia", shares: [{ uid: "m_tia", amountCents: 1, paidCents: 0 }, { uid: "ana", amountCents: 8000, paidCents: 0 }] }),
		]);
		const ana = r.debtors.find((d) => d.uid === "ana")!;
		expect(ana.items.map((i) => [i.description, i.payeeIsYou, i.payeeName])).toEqual([["Remédio", false, "Benjamim"]]);
		const tia = r.debtors.find((d) => d.uid === "m_tia")!;
		expect(tia).toMatchObject({ kind: "managed", name: "Tia", managedByName: "Bia", youManage: false, picture: null });
		expect(tia.items[0]).toMatchObject({ payeeIsYou: true, payeeName: "Eu" });
		expect(r.debtors.some((d) => d.uid === "me")).toBe(false); // o que você deve é "a pagar"
		expect(r.managedCents).toBe(3000);
		expect(r.totalCents).toBe(4200);
	});
	it("inclui tudo, mas separa 'agora' (sem data ou até o fim do mês) e o vencido", () => {
		const r = run([
			exp({ description: "sem data" }),
			exp({ description: "atrasada", dueDate: "2026-11-02" }),
			exp({ description: "fim do mês", dueDate: "2026-11-30" }),
			exp({ description: "mês que vem", dueDate: "2026-12-01" }),
			exp({ description: "parcela", dueDate: "2026-10-30", installment: { seriesId: "s", number: 2, count: 3 }, recurrence: { id: "r", period: "2026-10" } }),
		]);
		const d = r.debtors[0];
		expect(d.items.map((i) => i.description)).toEqual(["parcela", "atrasada", "fim do mês", "mês que vem", "sem data"]);
		expect(d.items.map((i) => i.overdue)).toEqual([true, true, false, false, false]);
		expect(d.items[0]).toMatchObject({ installment: { number: 2, count: 3 }, recurrence: true, dueDate: "2026-10-30", payeeIsYou: true });
		expect(d.items[4]).toMatchObject({ installment: null, recurrence: false, dueDate: null });
		expect(d.overdueCents).toBe(2000);
		expect([r.totalCents, r.nowCents]).toEqual([5000, 4000]);
	});
	it("limita a 200 itens (primeiros por vencimento) e avisa com truncated", () => {
		const many = Array.from({ length: 5 }, (_, i) => exp({ description: `d${i}`, dueDate: `2026-11-0${i + 1}` }));
		const r = run(many, 3);
		expect(r.truncated).toBe(true);
		expect(r.debtors[0].items.map((i) => i.description)).toEqual(["d0", "d1", "d2"]);
		expect(r.totalCents).toBe(3000);
	});
	it("nunca expõe e-mail nem chave Pix", () => {
		const json = JSON.stringify(run([exp({})]));
		expect(json).not.toContain("@");
		expect(json).not.toContain("pix");
	});
	it("nada a receber: lista vazia", () => {
		expect(run([])).toEqual({ debtors: [], totalCents: 0, nowCents: 0, managedCents: 0, truncated: false });
	});
});

describe("buildReceivables: a receber de volta", () => {
	const refundExp = (over: Record<string, unknown> = {}) =>
		exp({
			paidBy: "ana",
			createdBy: "ana",
			description: "Mercado",
			pix: { type: "email", key: "ana@x.com", payeeName: "Ana" },
			shares: [{ uid: "ana", amountCents: 1000, paidCents: 0 }, { uid: "me", amountCents: 1000, paidCents: 1500 }],
			...over,
		});
	const run2 = (refundExpenses: ExpenseDoc[]) => buildReceivables({ uid: "me", today: "2026-11-15", groups, expenses: [], refundExpenses, people });

	it("quem pagou a despesa (Ana) deve devolver a você; item 'refund' sem vencimento e entra no total", () => {
		const r = run2([refundExp()]);
		expect(r.debtors).toHaveLength(1);
		expect(r.debtors[0]).toMatchObject({ uid: "ana", totalCents: 500, overdueCents: 0 });
		expect(r.debtors[0].items[0]).toMatchObject({ kind: "refund", dueCents: 500, dueDate: null, payeeIsYou: true, payeeName: "Eu" });
		expect(r).toMatchObject({ totalCents: 500, nowCents: 500, managedCents: 0 });
	});
	it("devolução a quem você cuida entra como 'managed'; o que você mesmo paga a si/à sua casa não entra", () => {
		const toBen = refundExp({ shares: [{ uid: "ana", amountCents: 1000, paidCents: 0 }, { uid: "m_ben", amountCents: 1000, paidCents: 1300 }] });
		const r = run2([toBen]);
		expect(r).toMatchObject({ totalCents: 300, managedCents: 300 });
		expect(r.debtors[0].items[0]).toMatchObject({ payeeIsYou: false, payeeName: "Benjamim" });
		const mine = refundExp({ paidBy: "me", shares: [{ uid: "me", amountCents: 1000, paidCents: 0 }, { uid: "m_ben", amountCents: 1000, paidCents: 1300 }] });
		expect(run2([mine]).debtors).toEqual([]);
	});
	it("agrupa com a parte a pagar do mesmo devedor e ignora devolução alheia ou já feita", () => {
		const others = refundExp({ shares: [{ uid: "ana", amountCents: 1000, paidCents: 0 }, { uid: "bia", amountCents: 1000, paidCents: 1500 }] });
		expect(run2([others]).debtors).toEqual([]);
		const done = refundExp({ shares: [{ uid: "ana", amountCents: 1000, paidCents: 0 }, { uid: "me", amountCents: 1000, paidCents: 1000, refund: { cents: 500, at: new Date(), markedBy: "ana" } }] });
		expect(run2([done]).debtors).toEqual([]);
	});
});
