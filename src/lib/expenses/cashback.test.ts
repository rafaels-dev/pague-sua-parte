import { describe, expect, it } from "vitest";
import { CASHBACK_TOO_BIG, CASHBACK_TOO_BIG_FIRST, netPerInstallment, splitCashback } from "./cashback";

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe("splitCashback", () => {
	it("à vista: tudo na única despesa", () => {
		expect(splitCashback(100_000, 1, 5_000)).toEqual({ ok: true, perInstallment: [5_000] });
	});
	it("spread: divide igual e o resto vai 1 centavo para as primeiras", () => {
		const r = splitCashback(10_000, 3, 1_000, "spread");
		expect(r).toEqual({ ok: true, perInstallment: [334, 333, 333] });
		const r2 = splitCashback(10_000, 4, 10, "spread");
		expect(r2).toEqual({ ok: true, perInstallment: [3, 3, 2, 2] });
	});
	it("spread: a soma é exatamente o cashback, mesmo menor que o número de parcelas", () => {
		const r = splitCashback(10_000, 6, 4, "spread");
		expect(r).toEqual({ ok: true, perInstallment: [1, 1, 1, 1, 0, 0] });
		if (r.ok) expect(sum(r.perInstallment)).toBe(4);
	});
	it("first: tudo na primeira parcela", () => {
		expect(splitCashback(10_000, 3, 1_000, "first")).toEqual({ ok: true, perInstallment: [1_000, 0, 0] });
	});
	it("first: recusa cashback que não cabe na primeira parcela", () => {
		expect(splitCashback(10_000, 3, 10_000, "first")).toEqual({ ok: false, error: CASHBACK_TOO_BIG_FIRST });
		expect(splitCashback(10_000, 3, 9_999, "first").ok).toBe(true);
	});
	it("spread: o mesmo cashback cabe quando dividido", () => {
		expect(splitCashback(10_000, 3, 10_000, "spread").ok).toBe(true);
	});
	it("spread: recusa quando uma parcela ficaria sem valor", () => {
		expect(splitCashback(100, 2, 200, "spread")).toEqual({ ok: false, error: CASHBACK_TOO_BIG });
	});
	it("à vista: cashback igual ou maior que a compra é recusado", () => {
		expect(splitCashback(5_000, 1, 5_000)).toEqual({ ok: false, error: CASHBACK_TOO_BIG });
		expect(splitCashback(5_000, 1, 4_999).ok).toBe(true);
	});
	it("recusa cashback inválido", () => {
		expect(splitCashback(5_000, 1, 0).ok).toBe(false);
		expect(splitCashback(5_000, 1, 1.5).ok).toBe(false);
	});
});

describe("netPerInstallment: no máximo dois valores, o menor na primeira parcela", () => {
	it("vale para qualquer cashback e número de parcelas, nos dois modos", () => {
		for (const mode of ["spread", "first"] as const) {
			for (let count = 1; count <= 13; count++) {
				for (const cents of [1, 2, 3, 7, 12, 13, 29, 100, 997]) {
					const r = netPerInstallment(1_000, count, cents, mode);
					if (!r.ok) continue;
					const distinct = new Set(r.nets);
					expect(distinct.size).toBeLessThanOrEqual(2);
					expect(r.nets[0]).toBe(Math.min(...r.nets));
					expect(r.nets[r.nets.length - 1]).toBe(Math.max(...r.nets));
					expect(r.cashbacks.reduce((t, c) => t + c, 0)).toBe(cents);
				}
			}
		}
	});
});
