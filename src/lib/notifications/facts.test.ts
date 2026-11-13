import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { addedFact, paymentFacts, receiptDigest } from "./facts";
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

describe("paymentFacts: referência ao comprovante (nunca a chave do arquivo)", () => {
	const meta = { id: "r1", key: "receipts/g/e/SEGREDO", name: "c.pdf", contentType: "application/pdf", size: 10 };
	it("quitação com comprovante: referência 'payment' sem partId e com o resumo do arquivo, e nenhum campo com a chave", () => {
		const f = paymentFacts(e, [sh("a", 1000, 0)], [sh("a", 1000, 1000, { receipt: meta, paidAt: new Date(), markedBy: "a", method: "self" })], "a", false);
		expect(f[0].receipt).toEqual({ kind: "payment", digest: receiptDigest(meta.key) });
		expect(JSON.stringify(f)).not.toContain("SEGREDO");
		expect(receiptDigest(meta.key)).toMatch(/^[0-9a-f]{64}$/);
	});
	it("sem comprovante: sem referência", () => {
		expect(paymentFacts(e, [sh("a", 1000, 0)], [sh("a", 1000, 1000)], "a", false)[0]).not.toHaveProperty("receipt");
	});
	it("pagamento parcial com comprovante: aponta o id do parcial", () => {
		const part = { id: "pp1", cents: 400, at: new Date(), markedBy: "a", method: "self" as const, receipt: meta };
		const f = paymentFacts(e, [sh("a", 1000, 0)], [sh("a", 1000, 400, { parts: [part] })], "a", false);
		expect(f[0].receipt).toEqual({ kind: "payment", partId: "pp1", digest: receiptDigest(meta.key) });
	});
	it("devolução com comprovante: referência 'refund'", () => {
		const f = paymentFacts(e, [sh("a", 500, 1000), sh("p", 500, 0)], [sh("a", 500, 500, { refund: { ...refund, receipt: meta } }), sh("p", 500, 500)], "p", false);
		expect(f[0].receipt).toEqual({ kind: "refund", digest: receiptDigest(meta.key) });
	});
});

describe("paymentFacts: comprovante só do pagamento novo", () => {
	const old = { id: "old", key: "receipts/g/e/ANTIGO", name: "a.pdf", contentType: "application/pdf", size: 1 };
	const neu = { id: "new", key: "receipts/g/e/NOVO", name: "n.pdf", contentType: "application/pdf", size: 1 };
	const part = (r?: typeof old) => ({ id: "p1", cents: 1000, at: new Date(), markedBy: "a", method: "self" as const, ...(r ? { receipt: r } : {}) });
	it("parte recalculada para 'quitada' sem pagamento novo: o fato não aponta o comprovante antigo", () => {
		// antes: deve 3000, pagou 1000 (parcial com comprovante); depois da divisão recalculada: deve 1000, já pago
		const before = [sh("a", 3000, 1000, { parts: [part(old)] })];
		const after = [sh("a", 1000, 1000, { parts: [part(old)] })];
		const f = paymentFacts(e, before, after, "p", true);
		expect(f).toHaveLength(1); // comportamento já publicado: o aviso em si não muda
		expect(f[0]).not.toHaveProperty("receipt");
	});
	it("pagamento novo com comprovante: aponta o novo, não o antigo", () => {
		const before = [sh("a", 3000, 1000, { parts: [part(old)] })];
		const after = [sh("a", 3000, 3000, { parts: [part(old)], receipt: neu, paidAt: new Date(), markedBy: "a", method: "self" })];
		expect(paymentFacts(e, before, after, "a", false)[0].receipt).toEqual({ kind: "payment", digest: receiptDigest(neu.key) });
	});
	it("pagamento novo SEM comprovante, com um antigo na parte: sem referência (nada de anexar o antigo)", () => {
		const before = [sh("a", 3000, 1000, { parts: [part(old)] })];
		const after = [sh("a", 3000, 3000, { parts: [part(old)], paidAt: new Date(), markedBy: "p", method: "manual" })];
		expect(paymentFacts(e, before, after, "p", true)[0]).not.toHaveProperty("receipt");
	});
	it("segundo parcial sem comprovante depois de um parcial com comprovante: sem referência", () => {
		const p2 = { id: "p2", cents: 500, at: new Date(), markedBy: "a", method: "self" as const };
		const f = paymentFacts(e, [sh("a", 3000, 1000, { parts: [part(old)] })], [sh("a", 3000, 1500, { parts: [part(old), p2] })], "a", false);
		expect(f[0]).not.toHaveProperty("receipt");
	});
});

