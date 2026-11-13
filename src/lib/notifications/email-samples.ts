import { buildAdvanceNotices, buildMemberJoinedNotices, buildNewExpenseNotices, buildPaymentNotices } from "./messages";
import { buildPlanCancelledNotices, buildPlanChangeNotices, buildPlanClosedNotices, buildPlanConfirmedNotices } from "./plan-messages";
import type { NewExpenseFact, Notice, NoticeContext, PaymentFact, PlanNoticeBase } from "./types";
import { buildWelcomeNotice } from "./welcome";

/**
 * Um aviso fictício de cada tipo que o app envia, para a pré-visualização e os testes. Os textos saem das funções REAIS
 * (`messages.ts`, `plan-messages.ts`, adiantamento, boas-vindas) com fatos inventados: se o texto de um aviso mudar, a amostra muda junto.
 * O destinatário das amostras é sempre "eu".
 */
const G = "g1";
const E = "e1";
const members = [
	{ uid: "eu", role: "admin" as const },
	{ uid: "ana", role: "member" as const },
	{ uid: "bia", role: "member" as const },
	{ uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "eu", name: "Vó Lia" },
];
const NAMES: Record<string, string> = { eu: "Rafael", ana: "Ana", bia: "Bia", m_vo: "Vó Lia" };
const GROUPS: Record<string, string> = { [G]: "Viagem da família", g2: "Churrasco de sábado" };
const ctx: NoticeContext = { group: (id) => (GROUPS[id] ? { name: GROUPS[id], members } : undefined), name: (_g, uid) => NAMES[uid] ?? "Alguém" };

const pay = (o: Partial<PaymentFact> = {}): PaymentFact => ({ groupId: G, expenseId: E, description: "Aluguel da casa", paidBy: "eu", debtorUid: "bia", amountCents: 8450, kind: "payment", actorUid: "bia", manual: false, ...o });
const exp = (o: Partial<NewExpenseFact> = {}): NewExpenseFact => ({ groupId: G, expenseId: E, description: "Jantar de sexta", amountCents: 12680, paidBy: "ana", actorUid: "ana", shares: [{ uid: "eu", amountCents: 6340 }], ...o });
const plan: PlanNoticeBase = { planId: "p1", name: "Churrasco de sábado", totalCents: 180000, actorUid: "ana", creatorUid: "eu", participants: ["eu", "ana", "bia"], guests: [] };

function mine(notices: Notice[]): Notice {
	const n = notices.find((x) => x.uid === "eu");
	if (!n) throw new Error("amostra sem aviso para o destinatário");
	return n;
}

export const SAMPLE_NOTICES: { id: string; notice: Notice }[] = [
	{ id: "entrou-no-grupo", notice: mine(buildMemberJoinedNotices({ groupId: G, groupName: GROUPS[G], members, joinerUid: "bia", joinerName: "Bia" })) },
	{ id: "pagamento-recebido", notice: mine(buildPaymentNotices([pay()], ctx)) },
	{ id: "pagamento-parcial", notice: mine(buildPaymentNotices([pay({ amountCents: 4000, partial: { shareCents: 8450, remainingCents: 4450 } })], ctx)) },
	{ id: "parte-marcada-como-paga", notice: mine(buildPaymentNotices([pay({ paidBy: "bia", debtorUid: "eu", actorUid: "ana", manual: true, description: "Mercado", amountCents: 5230 })], ctx)) },
	{ id: "pagamento-em-lote", notice: mine(buildPaymentNotices([pay({ amountCents: 10500 }), pay({ expenseId: "e2", amountCents: 10500 })], ctx)) },
	{ id: "devolucao-recebida", notice: mine(buildPaymentNotices([pay({ kind: "refund", paidBy: "ana", debtorUid: "eu", actorUid: "ana", description: "Mercado", amountCents: 1200 })], ctx)) },
	{ id: "adiantamento-recebido", notice: mine(buildAdvanceNotices({ groupId: G, expenseId: E, description: "Sofá", paidBy: "eu", debtorUid: "ana", actorUid: "ana", manual: false, totalCents: 34700, items: [{ number: 1, cents: 10000, settled: true, remainingCents: 0 }, { number: 2, cents: 10000, settled: true, remainingCents: 0 }, { number: 3, cents: 10000, settled: true, remainingCents: 0 }, { number: 4, cents: 4700, settled: false, remainingCents: 5300 }] }, ctx)) },
	{ id: "despesa-nova", notice: mine(buildNewExpenseNotices(exp(), "created", ctx)) },
	{ id: "despesa-parcelada", notice: mine(buildNewExpenseNotices(exp({ description: "Geladeira", amountCents: 240000, installments: 10, shares: [{ uid: "eu", amountCents: 12000 }] }), "created", ctx)) },
	{ id: "despesa-parcelas-diferentes", notice: mine(buildNewExpenseNotices(exp({ description: "Geladeira", installments: 10, installmentsDiffer: true, shares: [{ uid: "eu", amountCents: 9500 }] }), "created", ctx)) },
	{ id: "despesa-de-quem-cuida", notice: mine(buildNewExpenseNotices(exp({ description: "Mercado", shares: [{ uid: "eu", amountCents: 4000 }, { uid: "m_vo", amountCents: 4000 }] }), "created", ctx)) },
	{ id: "despesa-em-seu-nome", notice: mine(buildNewExpenseNotices(exp({ description: "Gasolina", amountCents: 20000, paidBy: "eu", actorUid: "ana", shares: [{ uid: "ana", amountCents: 5000 }, { uid: "eu", amountCents: 5000 }] }), "created", ctx)) },
	{ id: "despesa-fixa", notice: mine(buildNewExpenseNotices(exp({ description: "Internet", amountCents: 9980, actorUid: null, shares: [{ uid: "eu", amountCents: 4990 }] }), "recurring", ctx)) },
	{ id: "incluido-na-despesa", notice: mine(buildNewExpenseNotices(exp({ description: "Presente da avó", shares: [{ uid: "eu", amountCents: 2500 }] }), "added", ctx)) },
	{ id: "plano-fecha", notice: mine(buildPlanChangeNotices({ ...plan, before: { fits: false, shareCents: null, includedUids: [] }, after: { fits: true, shareCents: 4500, includedUids: ["eu", "ana", "bia"] } })) },
	{ id: "plano-confirmado", notice: mine(buildPlanConfirmedNotices({ planName: "Churrasco de sábado", groupName: GROUPS.g2, groupId: "g2", actorUid: "ana" }, ctx)) },
	{ id: "boas-vindas", notice: buildWelcomeNotice({ uid: "eu", name: "Maria Souza" }) },
	{ id: "plano-cancelado", notice: mine(buildPlanCancelledNotices({ ...plan, goingIds: ["eu", "ana"] })) },
	{ id: "plano-fechado-sem-voce", notice: mine(buildPlanClosedNotices({ ...plan, leftOutIds: ["eu"] })) },
];
