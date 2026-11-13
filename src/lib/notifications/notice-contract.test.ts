import { describe, expect, it } from "vitest";
import { buildMemberJoinedNotices, buildNewExpenseNotices, buildPaymentNotices } from "./messages";
import { buildPlanCancelledNotices, buildPlanChangeNotices, buildPlanClosedNotices, buildPlanConfirmedNotices } from "./plan-messages";
import { buildWelcomeNotice } from "./welcome";
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

const scenarios: [string, Notice[]][] = [
	["entrou", buildMemberJoinedNotices({ groupId: G, groupName: "Família", members, joinerUid: "bia", joinerName: "Bia" })],
	["pagou", buildPaymentNotices([pay()], ctx)],
	["parcial", buildPaymentNotices([pay({ amountCents: 2000, partial: { shareCents: 5000, remainingCents: 3000 } })], ctx)],
	["marcou", buildPaymentNotices([pay({ manual: true, actorUid: "adm" })], ctx)],
	["devedor", buildPaymentNotices([pay({ manual: true, actorUid: "adm" })], ctx)],
	["devolução", buildPaymentNotices([pay({ kind: "refund", paidBy: "ana", debtorUid: "bia", actorUid: "ana" })], ctx)],
	["lote", buildPaymentNotices([pay(), pay({ expenseId: "e2" })], ctx)],
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
				if (n.amountCents !== undefined) expect(n.amountLabel, "amountLabel").toBeTruthy();
				if (n.amountLabel) expect(n.amountCents).toBeGreaterThan(0);
			}
		});
	}

	it("a legenda diz a verdade sobre o valor", () => {
		const by = (k: string) => scenarios.find(([n]) => n === k)![1];
		expect(by("pagou")[0].amountLabel).toBe("Valor recebido");
		expect(by("parcial")[0].amountLabel).toBe("Valor pago agora");
		expect(by("devolução")[0].amountLabel).toBe("Valor devolvido");
		expect(by("lote")[0].amountLabel).toBe("Total recebido");
		expect(by("parcelada")[0]).toMatchObject({ amountLabel: "Sua parte em cada parcela", amountCents: 5000 });
		expect(by("parcelas diferentes")[0].amountLabel).toBe("Sua parte na primeira parcela");
		expect(by("pessoa cuidada")[0]).toMatchObject({ amountLabel: "Sua parte e de quem você cuida", amountCents: 2000 });
		expect(by("plano fecha")[0].amountLabel).toBe("Cada um paga");
		for (const n of by("plano confirmado")) expect(n).not.toHaveProperty("amountCents"); // plano confirmado não leva valor
	});
});
