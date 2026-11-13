import { describe, expect, it } from "vitest";
import { amountRejectionResponse, hasKey, readPartialRequest } from "./amount-input";

const both = { amountCents: true, expectedPaidCents: true };
const none = { amountCents: false, expectedPaidCents: false };

describe("readPartialRequest: pagar/receber", () => {
	it("sem nenhuma das duas chaves é o pedido antigo (quitar o que falta)", () => {
		expect(readPartialRequest({}, none, "pay")).toEqual({ ok: true });
	});
	it("com as duas, inteiros: amountCents >= 1 (número ou texto de formulário) e expectedPaidCents >= 0", () => {
		expect(readPartialRequest({ amountCents: 4700, expectedPaidCents: 0 }, both, "pay")).toEqual({ ok: true, amountCents: 4700, expectedPaidCents: 0 });
		expect(readPartialRequest({ amountCents: "4700", expectedPaidCents: "300" }, both, "pay")).toEqual({ ok: true, amountCents: 4700, expectedPaidCents: 300 });
	});
	it.each([0, -1, 1.5, "0", "-1", "1.5", "1,5", "abc", " 12", "12 ", true, {}, [], NaN, Infinity, 1e12, "99999999999", "1e3", "0x10"])("amountCents %j é recusado", (v) => {
		expect(readPartialRequest({ amountCents: v, expectedPaidCents: 0 }, both, "pay")).toEqual({ ok: false });
	});
	it("chave presente mas vazia ou nula NUNCA vira quitação total", () => {
		for (const v of ["", null, undefined]) {
			expect(readPartialRequest({ amountCents: v, expectedPaidCents: 0 }, both, "pay")).toEqual({ ok: false });
			expect(readPartialRequest({ amountCents: 100, expectedPaidCents: v }, both, "pay")).toEqual({ ok: false });
		}
	});
	it("expectedPaidCents sozinho, ou amountCents sozinho, é recusado", () => {
		expect(readPartialRequest({ expectedPaidCents: 0 }, { amountCents: false, expectedPaidCents: true }, "pay")).toEqual({ ok: false });
		expect(readPartialRequest({ amountCents: 100 }, { amountCents: true, expectedPaidCents: false }, "pay")).toEqual({ ok: false });
	});
	it("expectedPaidCents recusa negativo, decimal e lixo", () => {
		for (const v of [-1, 1.5, "x", "1.5", true, 1e12, "-3"]) expect(readPartialRequest({ amountCents: 100, expectedPaidCents: v }, both, "pay")).toEqual({ ok: false });
	});
});

describe("readPartialRequest: desfazer", () => {
	it("expectedPaidCents é opcional (cliente antigo), mas se veio precisa ser válido; amountCents não cabe", () => {
		expect(readPartialRequest({}, none, "undo")).toEqual({ ok: true });
		expect(readPartialRequest({ expectedPaidCents: 0 }, { amountCents: false, expectedPaidCents: true }, "undo")).toEqual({ ok: true, expectedPaidCents: 0 });
		for (const v of ["", null, -1, 1.5, "x"]) expect(readPartialRequest({ expectedPaidCents: v }, { amountCents: false, expectedPaidCents: true }, "undo")).toEqual({ ok: false });
		expect(readPartialRequest({ amountCents: 100 }, { amountCents: true, expectedPaidCents: false }, "undo")).toEqual({ ok: false });
	});
});

describe("hasKey e respostas de erro", () => {
	it("hasKey conta null e vazio como presentes", () => {
		expect(hasKey({ a: null }, "a")).toBe(true);
		expect(hasKey({ a: "" }, "a")).toBe(true);
		expect(hasKey({}, "a")).toBe(false);
		expect(hasKey(null, "a")).toBe(false);
	});
	it("409 para valor maior e conta que mudou; 422 para o resto, com a mensagem simples", async () => {
		const too = amountRejectionResponse("too_much");
		expect([too.status, (await too.json()).error]).toEqual([409, "Esse valor é maior do que falta pagar. Atualize e tente de novo."]);
		const stale = amountRejectionResponse("stale");
		expect([stale.status, (await stale.json()).error]).toEqual([409, "Esta conta mudou. Atualize e confira antes de pagar de novo."]);
		const undo = amountRejectionResponse("stale_undo");
		expect([undo.status, await undo.json()]).toEqual([409, { error: "Esta conta mudou. Atualize e confira antes de desfazer." }]);
		expect(amountRejectionResponse("invalid_amount").status).toBe(422);
		expect(amountRejectionResponse("too_many_parts").status).toBe(422);
	});
});
