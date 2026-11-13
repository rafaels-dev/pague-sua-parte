import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { addedFact, paymentFacts } from "./facts";
import type { ExpenseShare } from "@/lib/expenses/shares";

const e = { _id: new ObjectId(), groupId: new ObjectId(), paidBy: "p", description: "Luz", amountCents: 3000 };
const sh = (uid: string, amountCents: number, paidCents: number, extra: Partial<ExpenseShare> = {}): ExpenseShare => ({ uid, amountCents, paidCents, ...extra });
const refund = { cents: 500, at: new Date(), markedBy: "p" };

describe("paymentFacts", () => {
	it("pendente que virou paga gera pagamento", () => {
		const f = paymentFacts(e, [sh("a", 1000, 0)], [sh("a", 1000, 1000)], "a", false);
		expect(f).toMatchObject([{ kind: "payment", debtorUid: "a", amountCents: 1000, actorUid: "a", manual: false }]);
	});
	it("já paga, desfazer e troca de comprovante não geram nada", () => {
		expect(paymentFacts(e, [sh("a", 1000, 1000)], [sh("a", 1000, 1000)], "a", false)).toEqual([]);
		expect(paymentFacts(e, [sh("a", 1000, 1000)], [sh("a", 1000, 0)], "p", true)).toEqual([]);
	});
	it("devolução feita gera devolução; a de quem pagou nunca conta", () => {
		const f = paymentFacts(e, [sh("a", 500, 1000), sh("p", 500, 0)], [sh("a", 500, 500, { refund }), sh("p", 500, 500)], "p", false);
		expect(f).toMatchObject([{ kind: "refund", debtorUid: "a", amountCents: 500 }]);
	});
	it("cotas no modelo antigo (status) também funcionam", () => {
		const old = { uid: "a", amountCents: 1000, status: "pending" } as unknown as ExpenseShare;
		expect(paymentFacts(e, [old], [sh("a", 1000, 1000)], "a", false)).toHaveLength(1);
	});
});

describe("paymentFacts: pagamento parcial", () => {
	const part = (cents: number) => ({ id: "p", cents, at: new Date(), markedBy: "a", method: "self" as const });
	it("pendente que continua pendente com mais pago gera aviso parcial com o valor pago agora e o que falta", () => {
		const f = paymentFacts(e, [sh("a", 10000, 0)], [sh("a", 10000, 4700, { parts: [part(4700)] })], "a", false);
		expect(f).toEqual([expect.objectContaining({ kind: "payment", debtorUid: "a", amountCents: 4700, manual: false, partial: { shareCents: 10000, remainingCents: 5300 } })]);
	});
	it("segundo parcial avisa só o que entrou agora; marcado por outra pessoa é manual", () => {
		const f = paymentFacts(e, [sh("a", 10000, 4700, { parts: [part(4700)] })], [sh("a", 10000, 5700, { parts: [part(4700), part(1000)] })], "p", true);
		expect(f).toEqual([expect.objectContaining({ amountCents: 1000, manual: true, actorUid: "p", partial: { shareCents: 10000, remainingCents: 4300 } })]);
	});
	it("quitar depois de parciais avisa o valor do último pagamento, sem campo partial", () => {
		const f = paymentFacts(e, [sh("a", 10000, 4700, { parts: [part(4700)] })], [sh("a", 10000, 10000, { parts: [part(4700)], paidAt: new Date(), markedBy: "a", method: "self" })], "a", false);
		expect(f).toHaveLength(1);
		expect(f[0].amountCents).toBe(5300);
		expect(f[0]).not.toHaveProperty("partial");
	});
	it("desfazer parcial e cota que não mudou não geram aviso", () => {
		expect(paymentFacts(e, [sh("a", 10000, 4700, { parts: [part(4700)] })], [sh("a", 10000, 0)], "p", true)).toEqual([]);
		expect(paymentFacts(e, [sh("a", 10000, 4700)], [sh("a", 10000, 4700)], "a", false)).toEqual([]);
		// a parte cresceu numa edição e nada foi pago: sem aviso de pagamento
		expect(paymentFacts(e, [sh("a", 10000, 4700)], [sh("a", 12000, 4700)], "p", false)).toEqual([]);
	});
});

describe("addedFact", () => {
	it("só quem entrou na divisão", () => {
		const f = addedFact(e, [sh("p", 1500, 0), sh("a", 1500, 0)], [sh("p", 1000, 0), sh("a", 1000, 0), sh("b", 1000, 0)], "p");
		expect(f?.shares).toEqual([{ uid: "b", amountCents: 1000 }]);
		expect(f?.actorUid).toBe("p");
	});
	it("mudança de valor sem ninguém novo não avisa", () => {
		expect(addedFact(e, [sh("a", 1000, 0)], [sh("a", 2000, 0)], "p")).toBeUndefined();
	});
});
