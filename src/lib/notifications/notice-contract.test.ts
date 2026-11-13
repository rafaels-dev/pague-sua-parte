import { describe, expect, it } from "vitest";
import { buildAdvanceNotices, buildMemberJoinedNotices, buildNewExpenseNotices, buildPaymentNotices } from "./messages";
import { buildPlanCancelledNotices, buildPlanChangeNotices, buildPlanClosedNotices, buildPlanConfirmedNotices } from "./plan-messages";
import { buildWelcomeNotice } from "./welcome";
import { buildReminderNotice } from "./reminder-messages";
import { toInboxDocs } from "./inbox";
import { formatBRL } from "@/lib/money";
import type { ReminderItem } from "@/lib/reminders/plan";
import type { NewExpenseFact, Notice, NoticeContext, PaymentFact, PlanNoticeBase, PlanSnapshot } from "./types";

// Contrato do e-mail: todo aviso tem `scope` (de onde vem) e, se leva valor, uma legenda que diga o que o valor é.
const G = "g1";
const members = [
	{ uid: "adm", role: "admin" as const },
	{ uid: "ana", role: "member" as const },
	{ uid: "bia", role: "member" as const },
	{ uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "ana" },
];
const ctx: NoticeContext = { group: (id) => (id === G ? { name: "Família", members } : undefined), name: (_g, uid) => uid };
const pay = (o: Partial<PaymentFact> = {}): PaymentFact => ({ groupId: G, expenseId: "e", description: "Mercado", paidBy: "bia", debtorUid: "ana", amountCents: 5000, kind: "payment", actorUid: "ana", manual: false, ...o });
const exp = (o: Partial<NewExpenseFact> = {}): NewExpenseFact => ({ groupId: G, expenseId: "e", description: "Luz", amountCents: 10000, paidBy: "bia", actorUid: "bia", shares: [{ uid: "ana", amountCents: 5000 }], ...o });
const base: PlanNoticeBase = { planId: "p", name: "Hotel", totalCents: 250000, actorUid: "ana", creatorUid: "cri", participants: ["cri", "ana", "bia"], guests: [{ id: "pg", name: "Ben", addedBy: "bia" }] };
const snap = (o: Partial<PlanSnapshot> = {}): PlanSnapshot => ({ fits: false, shareCents: null, includedUids: [], ...o });

const rem = (o: Partial<ReminderItem> = {}): ReminderItem => ({ recurrenceId: "r", groupId: G, groupName: "Família", period: "2026-11", lead: 7, uid: "ana", description: "Internet", dueDate: "2026-11-20", amountCents: 4990, exists: false, own: true, others: false, ...o });
const scenarios: [string, Notice[]][] = [
	...([15, 7, 3, 0] as const).map((lead): [string, Notice[]] => [`lembrete ${lead === 0 ? "hoje" : `${lead} dias`}`, [buildReminderNotice(rem({ lead })), buildReminderNotice(rem({ lead, exists: true, expenseId: "e", amountCents: 2000 }))]]),
	["lembrete (pessoa cuidada)", [buildReminderNotice(rem({ own: false, others: true })), buildReminderNotice(rem({ own: true, others: true, exists: true, expenseId: "e" }))]],
	["entrou", buildMemberJoinedNotices({ groupId: G, groupName: "Família", members, joinerUid: "bia", joinerName: "Bia" })],
	["pagou", buildPaymentNotices([pay()], ctx)],
	["parcial", buildPaymentNotices([pay({ amountCents: 2000, partial: { shareCents: 5000, remainingCents: 3000 } })], ctx)],
	["marcou", buildPaymentNotices([pay({ manual: true, actorUid: "adm" })], ctx)],
	["devedor", buildPaymentNotices([pay({ manual: true, actorUid: "adm" })], ctx)],
	["devolução", buildPaymentNotices([pay({ kind: "refund", paidBy: "ana", debtorUid: "bia", actorUid: "ana" })], ctx)],
	["lote", buildPaymentNotices([pay(), pay({ expenseId: "e2" })], ctx)],
	["adiantamento (quem recebe)", buildAdvanceNotices({ groupId: G, expenseId: "e", description: "Sofá", paidBy: "bia", debtorUid: "ana", actorUid: "ana", manual: false, totalCents: 34700, items: [{ number: 1, cents: 34700, settled: true, remainingCents: 0 }] }, ctx)],
	["adiantamento (registrado pelo administrador)", buildAdvanceNotices({ groupId: G, expenseId: "e", description: "Sofá", paidBy: "bia", debtorUid: "ana", actorUid: "adm", manual: true, totalCents: 34700, items: [{ number: 1, cents: 34700, settled: true, remainingCents: 0 }] }, ctx)],
	["nova", buildNewExpenseNotices(exp(), "created", ctx)],
	["parcelada", buildNewExpenseNotices(exp({ installments: 10 }), "created", ctx)],
	["parcelas diferentes", buildNewExpenseNotices(exp({ installments: 10, installmentsDiffer: true }), "created", ctx)],
	["pessoa cuidada", buildNewExpenseNotices(exp({ shares: [{ uid: "ana", amountCents: 1000 }, { uid: "m_vo", amountCents: 1000 }] }), "created", ctx)],
	["em nome", buildNewExpenseNotices(exp({ actorUid: "adm", paidBy: "bia", shares: [{ uid: "ana", amountCents: 1000 }, { uid: "bia", amountCents: 1000 }] }), "created", ctx)],
	["fixa", buildNewExpenseNotices(exp({ actorUid: null }), "recurring", ctx)],
	["incluído", buildNewExpenseNotices(exp(), "added", ctx)],
	["plano fecha", buildPlanChangeNotices({ ...base, before: snap(), after: snap({ fits: true, shareCents: 27778, includedUids: ["cri", "ana"] }) })],
	["plano confirmado", buildPlanConfirmedNotices({ planName: "Hotel", groupName: "Hotel", groupId: G, actorUid: "adm" }, ctx)],
	["boas-vindas", [buildWelcomeNotice({ uid: "ana", name: "Ana Maria" })]],
	["plano cancelado", buildPlanCancelledNotices({ ...base, actorUid: "cri", goingIds: ["ana", "bia"] })],
	["plano fechado", buildPlanClosedNotices({ ...base, actorUid: "cri", leftOutIds: ["ana", "pg"] })],
];

describe("contrato dos avisos para o e-mail", () => {
	for (const [name, notices] of scenarios) {
		it(`${name}: tem aviso, tem scope e todo valor tem legenda`, () => {
			expect(notices.length).toBeGreaterThan(0);
			for (const n of notices) {
				expect(n.scope?.name, "scope").toBeTruthy();
				expect(n.subject?.trim(), "subject").toBeTruthy();
				expect(n.subject!.length, "subject curto").toBeLessThanOrEqual(80);
				expect(n.subject, "uma linha só").not.toMatch(/[\r\n]/);
				expect(JSON.stringify(n.subject), "nada de Pix nem token no assunto").not.toMatch(/pix|token/i);
				if (n.amountCents !== undefined) expect(n.amountLabel, "amountLabel").toBeTruthy();
				if (n.amountLabel) expect(n.amountCents).toBeGreaterThan(0);
			}
		});
	}

	it("avisos diferentes do mesmo tipo têm assuntos diferentes (o Gmail não os junta numa conversa)", () => {
		const subjects = (list: Notice[]) => list.map((n) => n.subject);
		const a = subjects(buildPaymentNotices([pay({ description: "Aluguel" })], ctx));
		const b = subjects(buildPaymentNotices([pay({ description: "Mercado" })], ctx));
		expect(a).not.toEqual(b);
		const c = subjects(buildPaymentNotices([pay({ amountCents: 1000 })], ctx));
		expect(c).not.toEqual(subjects(buildPaymentNotices([pay({ amountCents: 2000 })], ctx)));
		expect(subjects(buildNewExpenseNotices(exp({ description: "Luz" }), "created", ctx))).not.toEqual(subjects(buildNewExpenseNotices(exp({ description: "Água" }), "created", ctx)));
		expect(subjects(buildPlanCancelledNotices({ ...base, actorUid: "cri", goingIds: ["ana"] }))).not.toEqual(subjects(buildPlanCancelledNotices({ ...base, name: "Outro", actorUid: "cri", goingIds: ["ana"] })));
	});

	it("nome comprido é cortado com reticências e o valor fica inteiro", () => {
		const n = buildPaymentNotices([pay({ description: "x".repeat(200), amountCents: 123456 })], ctx)[0];
		expect(n.subject!.length).toBeLessThanOrEqual(80);
		expect(n.subject).toContain("R$ 1.234,56");
		expect(n.subject).toContain("…");
	});

	it("o texto de pré-visualização (corpo) não repete o assunto", () => {
		for (const [, list] of scenarios) for (const n of list) if (n.subject !== n.title) expect(n.body).not.toBe(n.subject);
	});

	it("assunto x corpo: todo valor do assunto aparece no corpo ou é o valor em destaque; o nome da despesa/plano/grupo bate", () => {
		for (const [name, notices] of scenarios) {
			for (const n of notices) {
				if (n.subject === n.title) continue; // boas-vindas
				for (const m of n.subject!.match(/R\$ [\d.]+,\d{2}/g) ?? []) {
					const ok = n.body.includes(m) || (n.amountCents !== undefined && m === formatBRL(n.amountCents));
					expect(ok, `${name}: ${m} em "${n.subject}" vs "${n.body}"`).toBe(true);
				}
				for (const q of n.subject!.match(/"[^"]+"/g) ?? []) expect(n.body, name).toContain(q);
			}
		}
	});

	it("a legenda diz a verdade sobre o valor", () => {
		const by = (k: string) => scenarios.find(([n]) => n === k)![1];
		expect(by("pagou")[0].amountLabel).toBe("Valor recebido");
		expect(by("parcial")[0].amountLabel).toBe("Valor pago agora");
		expect(by("adiantamento (quem recebe)")[0]).toMatchObject({ amountLabel: "Valor adiantado", amountCents: 34700 });
		expect(by("adiantamento (registrado pelo administrador)").map((n) => n.amountLabel)).toEqual(["Valor adiantado", "Valor adiantado"]);
		expect(by("devolução")[0].amountLabel).toBe("Valor devolvido");
		expect(by("lote")[0].amountLabel).toBe("Total recebido");
		expect(by("parcelada")[0]).toMatchObject({ amountLabel: "Sua parte em cada parcela", amountCents: 5000 });
		expect(by("parcelas diferentes")[0].amountLabel).toBe("Sua parte na primeira parcela");
		expect(by("pessoa cuidada")[0]).toMatchObject({ amountLabel: "Sua parte e de quem você cuida", amountCents: 2000 });
		expect(by("plano fecha")[0].amountLabel).toBe("Cada um paga");
		for (const n of by("plano confirmado")) expect(n).not.toHaveProperty("amountCents"); // plano confirmado não leva valor
	});
});

describe("caixa de avisos (sininho): um documento por aviso que vai ao push", () => {
	const NOW = new Date("2026-11-13T12:00:00Z");
	for (const [name, notices] of scenarios) {
		it(`${name}: grava só o texto do push, sem Pix, comprovante, e-mail nem assunto`, () => {
			const docs = toInboxDocs(notices, NOW);
			const expected = notices.filter((n) => !n.emailOnly);
			expect(docs).toHaveLength(expected.length);
			if (name === "boas-vindas") expect(docs).toHaveLength(0);
			docs.forEach((d, i) => {
				expect(Object.keys(d).sort()).toEqual(expect.arrayContaining(["uid", "title", "body", "url", "createdAt"]));
				expect(Object.keys(d).every((k) => ["uid", "title", "body", "url", "scope", "createdAt"].includes(k))).toBe(true);
				expect(d).toMatchObject({ uid: expected[i].uid, title: expected[i].title, body: expected[i].body, createdAt: NOW });
				expect(d.url).toMatch(/^\/(app|convite\/)/);
				expect(JSON.stringify(d)).not.toMatch(/receipts|digest|subject|"email"|html/i);
			});
		});
	}
});
