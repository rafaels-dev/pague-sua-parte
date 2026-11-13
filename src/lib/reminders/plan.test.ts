import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { ExpenseDoc } from "@/lib/expenses/repo";
import type { RecurrenceDoc } from "@/lib/recurrences/collection";
import { buildReminderNotice } from "@/lib/notifications/reminder-messages";
import { expenseKey, leadFor, planReminders, rotateWithinLead, type ReminderItem } from "./plan";

const GID = new ObjectId("507f1f77bcf86cd799439011");
const RID = new ObjectId("607f1f77bcf86cd799439011");
const m = (uid: string, extra: object = {}) => ({ uid, role: "member" as const, joinedAt: new Date(), ...extra });
const mk = (members = [m("pag"), m("ana"), m("bia")]) => ({ _id: GID, name: "Casa", members }) as never;
const rec = (o: Partial<RecurrenceDoc> = {}): RecurrenceDoc => ({
	_id: RID, groupId: GID, createdBy: "pag", paidBy: "pag", description: "Internet", amountCents: 9000, dayOfMonth: 20,
	participantMode: "all", participantUids: [], startPeriod: "2026-01", nextPeriod: "2026-12", active: true, createdAt: new Date(), updatedAt: new Date(), ...o,
});
const groupsOf = (g = mk()) => new Map([[GID.toHexString(), g]]) as never;
const none = new Map();
const run = (today: string, o: { recs?: RecurrenceDoc[]; g?: unknown; ex?: Map<string, never> } = {}) =>
	planReminders({ today, recurrences: o.recs ?? [rec()], groups: o.g ? (new Map([[GID.toHexString(), o.g]]) as never) : groupsOf(), expenses: o.ex ?? none });
const exp = (shares: { uid: string; amountCents: number; paidCents: number }[], o: object = {}) =>
	({ _id: new ObjectId(), paidBy: "pag", description: "Internet", shares, dueDate: "2026-11-20", ...o }) as unknown as ExpenseDoc;
const withExp = (e: ExpenseDoc, period = "2026-11") => new Map([[expenseKey(RID.toHexString(), period), e]]) as never;

describe("leadFor", () => {
	it("15, 7, 3 e 0 dias antes do vencimento; qualquer outro dia, nada", () => {
		const due = "2026-11-20";
		expect(leadFor("2026-11-05", due)).toBe(15);
		expect(leadFor("2026-11-13", due)).toBe(7);
		expect(leadFor("2026-11-17", due)).toBe(3);
		expect(leadFor("2026-11-20", due)).toBe(0);
		for (const d of ["2026-11-04", "2026-11-06", "2026-11-12", "2026-11-18", "2026-11-19", "2026-11-21"]) expect(leadFor(d, due), d).toBeNull();
	});
	it("atravessa o fim do mês e do ano", () => {
		expect(leadFor("2026-12-17", "2027-01-01")).toBe(15);
		expect(leadFor("2026-02-13", "2026-02-28")).toBe(15);
	});
});

describe("planReminders: mês que ainda não existe (previsto, sem criar nada)", () => {
	it("dia 20, hoje 13/11, nextPeriod = próximo mês de 11: nada; hoje 13/12 lembra a parte prevista", () => {
		expect(run("2026-11-13", { recs: [rec({ nextPeriod: "2026-12" })] })).toEqual([]);
	});
	it("mês atual ainda sem despesa criada (nextPeriod = mês atual): lembra com a parte prevista (divisão igual), nunca quem paga", () => {
		const r = run("2026-11-13", { recs: [rec({ nextPeriod: "2026-11" })] });
		expect(r.map((i) => [i.uid, i.amountCents, i.lead, i.period, i.exists])).toEqual([["ana", 3000, 7, "2026-11", false], ["bia", 3000, 7, "2026-11", false]]);
		expect(r.every((i) => i.uid !== "pag")).toBe(true);
	});
	it("o mês SEGUINTE também: dia 20 de dezembro, hoje 05/12 (15 dias antes)", () => {
		const r = run("2026-12-05", { recs: [rec({ nextPeriod: "2026-12" })] });
		expect(r).toHaveLength(2);
		expect(r[0]).toMatchObject({ lead: 15, period: "2026-12", dueDate: "2026-12-20" });
	});
	it("próximo mês visto do mês anterior: dia 3, hoje 19/11 (15 dias) lembra dezembro", () => {
		const r = run("2026-11-18", { recs: [rec({ dayOfMonth: 3, nextPeriod: "2026-11" })] });
		expect(r.map((i) => i.period)).toEqual(["2026-12", "2026-12"]);
	});
	it("mês já gerado e depois apagado (período < nextPeriod, sem despesa): ninguém", () => {
		expect(run("2026-11-13", { recs: [rec({ nextPeriod: "2026-12" })] })).toEqual([]);
	});
	it("fora do intervalo da despesa fixa (depois do mês final): ninguém", () => {
		expect(run("2026-11-13", { recs: [rec({ nextPeriod: "2026-11", endPeriod: "2026-10" })] })).toEqual([]);
	});
	it("pausada/encerrada à mão: ninguém", () => {
		expect(run("2026-11-13", { recs: [rec({ nextPeriod: "2026-11", active: false, endedAt: new Date() })] })).toEqual([]);
	});
	it("quem paga saiu do grupo: ninguém", () => {
		expect(run("2026-11-13", { recs: [rec({ nextPeriod: "2026-11" })], g: mk([m("ana"), m("bia")]) })).toEqual([]);
	});
	it("participantes escolhidos: só quem ainda é do grupo; quem saiu não é lembrado", () => {
		const r = run("2026-11-13", { recs: [rec({ nextPeriod: "2026-11", participantMode: "selected", participantUids: ["ana", "fora"] })] });
		expect(r.map((i) => i.uid)).toEqual(["ana"]);
	});
});

describe("planReminders: despesa do mês que já existe", () => {
	it("usa o vencimento DA DESPESA (editado) e só lembra quem ainda deve; parcial conta; quitado fica de fora", () => {
		const e = exp([{ uid: "pag", amountCents: 3000, paidCents: 0 }, { uid: "ana", amountCents: 3000, paidCents: 1000 }, { uid: "bia", amountCents: 3000, paidCents: 3000 }], { dueDate: "2026-11-25" });
		const r = run("2026-11-22", { ex: withExp(e) }); // 3 dias antes do dia 25, não do 20
		expect(r.map((i) => [i.uid, i.amountCents, i.lead, i.exists])).toEqual([["ana", 2000, 3, true]]);
		expect(r[0].expenseId).toBe(e._id.toHexString());
		expect(run("2026-11-17", { ex: withExp(e) })).toEqual([]); // o vencimento antigo (20) não vale mais
	});
	it("todos pagaram: ninguém", () => {
		const e = exp([{ uid: "pag", amountCents: 3000, paidCents: 0 }, { uid: "ana", amountCents: 6000, paidCents: 6000 }]);
		expect(run("2026-11-20", { ex: withExp(e) })).toEqual([]);
	});
	it("devolução (pagou a mais) não é dívida", () => {
		expect(run("2026-11-20", { ex: withExp(exp([{ uid: "ana", amountCents: 1000, paidCents: 5000 }])) })).toEqual([]);
	});
	it("pessoa cuidada: quem cuida recebe, com o total sob sua responsabilidade; sem login e sem responsável: ninguém", () => {
		const g = mk([m("pag"), m("ana"), m("m_vo", { kind: "managed", managedBy: "ana" }), m("m_orf", { kind: "managed" })]);
		const e = exp([{ uid: "ana", amountCents: 1000, paidCents: 0 }, { uid: "m_vo", amountCents: 1500, paidCents: 0 }, { uid: "m_orf", amountCents: 900, paidCents: 0 }]);
		const r = run("2026-11-20", { g, ex: withExp(e) });
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ uid: "ana", amountCents: 2500, own: true, others: true });
	});
	it("quem cuida de quem pagou não é lembrado (é o recebedor)", () => {
		const g = mk([m("ana"), m("m_pag", { kind: "managed", managedBy: "ana" }), m("bia")]);
		const e = exp([{ uid: "ana", amountCents: 1000, paidCents: 0 }, { uid: "bia", amountCents: 1000, paidCents: 0 }], { paidBy: "m_pag" });
		expect(run("2026-11-20", { g, ex: withExp(e) }).map((i) => i.uid)).toEqual(["bia"]);
	});
	it("pessoa que saiu do grupo: sem lembrete", () => {
		expect(run("2026-11-20", { ex: withExp(exp([{ uid: "saiu", amountCents: 1000, paidCents: 0 }])) })).toEqual([]);
	});
	it("encerrada pelo calendário (último mês já gerado): a despesa existente ainda lembra; sem despesa, não", () => {
		const r0 = rec({ active: false, endPeriod: "2026-11", nextPeriod: "2026-12", endedAt: new Date() });
		const e = exp([{ uid: "ana", amountCents: 1000, paidCents: 0 }]);
		expect(run("2026-11-20", { recs: [r0], ex: withExp(e) })).toHaveLength(1);
		expect(run("2026-11-20", { recs: [r0] })).toEqual([]);
	});
});

describe("planReminders: ordem e estabilidade", () => {
	it("mais urgente primeiro; mesma entrada, mesma saída", () => {
		const a = rec({ _id: new ObjectId("607f1f77bcf86cd799439022"), dayOfMonth: 20, nextPeriod: "2026-11", description: "A" });
		const b = rec({ _id: new ObjectId("607f1f77bcf86cd799439033"), dayOfMonth: 13, nextPeriod: "2026-11", description: "B" });
		const r = run("2026-11-13", { recs: [a, b] });
		expect(r.map((i) => i.lead)).toEqual([0, 0, 7, 7]);
		expect(run("2026-11-13", { recs: [b, a] })).toEqual(r);
	});
});

describe("texto do lembrete", () => {
	const item = (o: Partial<ReminderItem> = {}): ReminderItem => ({ recurrenceId: "r", groupId: "g1", groupName: "Casa", period: "2026-11", lead: 7, uid: "ana", description: "Internet", dueDate: "2026-11-20", amountCents: 4990, exists: false, own: true, others: false, ...o });
	it("mês futuro: parte prevista; botão leva ao grupo", () => {
		const n = buildReminderNotice(item());
		expect(n).toMatchObject({ title: "Lembrete de vencimento", subject: 'Lembrete: "Internet" vence em 7 dias · R$ 49,90', body: '"Internet" (Casa) vence em 7 dias, no dia 20/11. Sua parte: R$ 49,90', url: "/app/grupos/g1", amountCents: 4990, amountLabel: "Sua parte", scope: { kind: "group", name: "Casa" } });
	});
	it("no dia, despesa criada: 'Falta pagar' e link da despesa", () => {
		const n = buildReminderNotice(item({ lead: 0, exists: true, expenseId: "e9" }));
		expect(n.body).toBe('"Internet" (Casa) vence hoje. Falta pagar: R$ 49,90');
		expect(n.subject).toBe('Lembrete: "Internet" vence hoje · R$ 49,90');
		expect(n.url).toBe("/app/grupos/g1/despesas/e9");
		expect(n.amountLabel).toBe("Falta pagar");
	});
	it("pessoa cuidada: texto verdadeiro; nunca Pix", () => {
		expect(buildReminderNotice(item({ own: false, others: true })).amountLabel).toBe("Parte de quem você cuida");
		expect(buildReminderNotice(item({ own: true, others: true })).amountLabel).toBe("Sua parte e de quem você cuida");
		expect(JSON.stringify(buildReminderNotice(item()))).not.toMatch(/pix/i);
	});
	it("nome comprido: corta o nome, o valor fica e o assunto cabe em 80", () => {
		const n = buildReminderNotice(item({ description: "x".repeat(200) }));
		expect(n.subject!.length).toBeLessThanOrEqual(80);
		expect(n.subject).toContain("R$ 49,90");
	});
});

describe("rotateWithinLead: ordem justa com teto", () => {
	const it0 = (lead: 0 | 3 | 7 | 15, uid: string) => ({ lead, uid, groupId: "g", recurrenceId: "r", period: "2026-11" }) as unknown as ReminderItem;
	const items = [it0(0, "a"), it0(0, "b"), it0(0, "c"), it0(7, "d"), it0(7, "e"), it0(15, "f")];
	it("a urgência continua mandando e dentro do nível a lista gira com a data", () => {
		const d1 = rotateWithinLead(items, "2026-11-10").map((i) => i.uid + i.lead);
		const d2 = rotateWithinLead(items, "2026-11-11").map((i) => i.uid + i.lead);
		for (const order of [d1, d2]) expect(order.map((x) => x.slice(1))).toEqual(["0", "0", "0", "7", "7", "15"]); // 0 primeiro, depois 7, depois 15
		expect(d1).not.toEqual(d2);
		// o primeiro do nível "0" muda de um dia para o outro: ninguém fica sempre no fim
		const firsts = new Set(["2026-11-10", "2026-11-11", "2026-11-12"].map((d) => rotateWithinLead(items, d)[0].uid));
		expect(firsts.size).toBe(3);
	});
	it("determinística e sem perder nem repetir item", () => {
		const a = rotateWithinLead(items, "2026-11-10");
		expect(rotateWithinLead(items, "2026-11-10")).toEqual(a);
		expect([...a].sort((x, y) => x.uid.localeCompare(y.uid))).toEqual([...items].sort((x, y) => x.uid.localeCompare(y.uid)));
		expect(rotateWithinLead([], "2026-11-10")).toEqual([]);
	});
});

