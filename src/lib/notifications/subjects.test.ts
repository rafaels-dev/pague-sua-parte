import { describe, expect, it } from "vitest";
import { oneLine } from "./email-content";
import { buildAdvanceNotices, buildMemberJoinedNotices, buildNewExpenseNotices, buildPaymentNotices } from "./messages";
import { buildPlanCancelledNotices, buildPlanChangeNotices, buildPlanClosedNotices, buildPlanConfirmedNotices } from "./plan-messages";
import { buildReminderNotice } from "./reminder-messages";
import { clipText, fitSubject, SUBJECT_MAX } from "./subjects";
import type { Notice, NoticeContext } from "./types";

const seg = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
/** Nenhum emoji ou letra composta cortado ao meio: o texto, segmentado de novo, não tem pedaços soltos. */
const noBrokenGraphemes = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s) && !/‍$/.test(s.replace(/…$/, ""));

const EMOJI_FAMILY = "👩‍👩‍👧‍👦";
const HUGE = "x".repeat(300);
const names = [HUGE, EMOJI_FAMILY.repeat(40), "João da Silva Sauro de Albuquerque Maranhão", "é".normalize("NFD").repeat(120), "A", "", "🇧🇷".repeat(60)];
const amounts = [1, 99, 100_000_000, 123_456_789];

describe("clipText", () => {
	it("não parte emoji, bandeira nem letra com acento composto", () => {
		for (const n of names) for (const max of [5, 10, 33, 60]) {
			const c = clipText(n, max);
			expect(c.length).toBeLessThanOrEqual(max);
			expect(noBrokenGraphemes(c), `${max}: ${c}`).toBe(true);
			for (const g of Array.from(seg.segment(c.replace(/…$/, "")), (x) => x.segment)) expect(Array.from(seg.segment(g))).toHaveLength(1);
		}
		expect(clipText(`${EMOJI_FAMILY}${EMOJI_FAMILY}`, 12)).toBe(`${EMOJI_FAMILY}…`);
		expect(clipText("curto", 60)).toBe("curto");
	});
});

describe("fitSubject: sempre até 80, valor inteiro, uma linha", () => {
	const ctx: NoticeContext = { group: () => ({ name: "Grupo", members: [{ uid: "a", role: "admin" }, { uid: "b" }, { uid: "c" }, { uid: "m_vo", kind: "managed", managedBy: "b" }] }), name: (_g, uid) => names[uid.charCodeAt(0) % names.length] };
	const ctxWith = (person: string): NoticeContext => ({ group: ctx.group, name: () => person });
	const money = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

	function check(n: Notice, cents?: number) {
		const sub = n.subject!;
		expect(sub.length, sub).toBeLessThanOrEqual(SUBJECT_MAX);
		expect(sub).not.toMatch(/[\r\n]/);
		expect(sub).toBe(oneLine(sub));
		expect(noBrokenGraphemes(sub), sub).toBe(true);
		if (cents !== undefined) expect(sub, "valor inteiro").toContain(money(cents));
	}

	it("pagamentos, devoluções e lotes com nomes e valores extremos", () => {
		for (const person of names) for (const desc of names) for (const cents of amounts) {
			const c = ctxWith(person);
			const pay = (o = {}) => ({ groupId: "g", expenseId: "e", description: desc || "x", paidBy: "a", debtorUid: "b", amountCents: cents, kind: "payment" as const, actorUid: "b", manual: false, ...o });
			check(buildPaymentNotices([pay()], c)[0], cents);
			check(buildPaymentNotices([pay({ partial: { shareCents: cents, remainingCents: cents } })], c)[0], cents);
			check(buildPaymentNotices([pay({ manual: true, actorUid: "c", debtorUid: "b" })], c)[0], cents); // pagamento marcado por outra pessoa
			check(buildPaymentNotices([pay({ kind: "refund", paidBy: "b", debtorUid: "a", actorUid: "b" })], c)[0], cents);
			check(buildPaymentNotices([pay(), pay({ expenseId: "e2" })], c)[0]);
			check(buildPaymentNotices([pay({ manual: true, actorUid: "c" })], c).find((n) => n.uid === "b" || n.uid === "a")!, cents);
		}
	});
	it("adiantamento, despesa nova, dividida, fixa, entrou, planos e lembretes", () => {
		for (const person of names) for (const desc of names) for (const cents of amounts) {
			const c = ctxWith(person);
			check(buildAdvanceNotices({ groupId: "g", expenseId: "e", description: desc || "x", paidBy: "a", debtorUid: "b", actorUid: "b", manual: false, totalCents: cents, items: [{ number: 1, cents, settled: true, remainingCents: 0 }] }, c)[0], cents);
			const exp = { groupId: "g", expenseId: "e", description: desc || "x", amountCents: cents, paidBy: "a", actorUid: "c", shares: [{ uid: "b", amountCents: cents }, { uid: "m_vo", amountCents: cents }] };
			for (const mode of ["created", "added", "recurring"] as const) for (const n of buildNewExpenseNotices({ ...exp, installments: 3 }, mode, c)) check(n, n.uid === "b" ? cents * 2 : undefined);
			check(buildNewExpenseNotices({ ...exp, actorUid: "b", paidBy: "c", shares: [{ uid: "a", amountCents: cents }] }, "created", c).find((n) => n.uid === "c")!);
			check(buildMemberJoinedNotices({ groupId: "g", groupName: desc || "x", members: [{ uid: "a", role: "admin" }], joinerUid: "z", joinerName: person })[0]);
			const base = { planId: "p", name: desc || "x", totalCents: cents, actorUid: "x", creatorUid: "a", participants: ["a", "b"], guests: [{ id: "g1", name: person || "Ana", addedBy: "b" }] };
			check(buildPlanChangeNotices({ ...base, before: { fits: false, shareCents: null, includedUids: [] }, after: { fits: true, shareCents: cents, includedUids: ["a", "b"] } })[0], cents);
			check(buildPlanCancelledNotices({ ...base, goingIds: ["a"] })[0]);
			check(buildPlanClosedNotices({ ...base, leftOutIds: ["g1"] })[0]);
			check(buildPlanConfirmedNotices({ planName: desc || "x", groupName: "Grupo", groupId: "g", actorUid: "x" }, c)[0]);
			for (const lead of [15, 7, 3, 0] as const) check(buildReminderNotice({ recurrenceId: "r", groupId: "g", groupName: person || "G", period: "2026-11", lead, uid: "b", description: desc || "x", dueDate: "2026-11-20", amountCents: cents, exists: lead === 0, own: true, others: lead === 3 }), cents);
		}
	});
	it("fitSubject sozinho: o nome é cortado, nunca o resto", () => {
		const s = fitSubject((n) => `Pagou R$ 1.234,56 em "${n}"`, EMOJI_FAMILY.repeat(50));
		expect(s.length).toBeLessThanOrEqual(80);
		expect(s).toContain("R$ 1.234,56");
		expect(s).toContain("…");
		expect(noBrokenGraphemes(s)).toBe(true);
	});
});
