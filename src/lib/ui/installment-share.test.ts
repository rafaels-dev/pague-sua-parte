import { describe, expect, it } from "vitest";
import { installmentShareInfo } from "./installment-share";

const items = (...v: (number | undefined)[]) => ({ items: v.map((amountCents) => ({ amountCents })) });

describe("installmentShareInfo", () => {
	it("parcelas iguais e completas: vale o valor", () => {
		expect(installmentShareInfo({ count: 3 }, items(100, 100, 100))).toEqual({ count: 3, sameValue: true });
	});
	it("valores diferentes (cashback): não afirma valor", () => {
		expect(installmentShareInfo({ count: 3 }, items(90, 100, 100))).toEqual({ count: 3, sameValue: false });
	});
	it("uma parcela apagada, valores iguais: usa a contagem real e mantém o valor", () => {
		expect(installmentShareInfo({ count: 6 }, items(100, 100, 100, 100, 100))).toEqual({ count: 5, sameValue: true });
	});
	it("uma parcela apagada e valores diferentes: contagem real, sem valor", () => {
		expect(installmentShareInfo({ count: 6 }, items(90, 100, 100, 100, 100))).toEqual({ count: 5, sameValue: false });
	});
	it("sem série ou sem valores conhecidos: mantém a contagem e o texto antigo", () => {
		expect(installmentShareInfo({ count: 4 }, null)).toEqual({ count: 4, sameValue: true });
		expect(installmentShareInfo({ count: 2 }, items(undefined, undefined))).toEqual({ count: 2, sameValue: true });
	});
});
