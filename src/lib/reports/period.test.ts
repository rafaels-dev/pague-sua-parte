import { describe, expect, it } from "vitest";
import { dateFilter, inPeriod, parsePeriod, periodKey } from "./period";

describe("parsePeriod", () => {
	it("aceita all (e ausente), month e year", () => {
		for (const raw of [undefined, null, "", "all"]) expect(parsePeriod(raw)).toEqual({ kind: "all" });
		expect(parsePeriod("month:2026-11")).toEqual({ kind: "month", month: "2026-11" });
		expect(parsePeriod("year:2026")).toEqual({ kind: "year", year: "2026" });
	});
	it("rejeita o resto", () => {
		for (const raw of ["month:2026-13", "month:2026-00", "month:2026-1", "month:26-11", "year:26", "year:2026-11", "week:1", "ALL", "month:", "month:2026-11 ", "2026-11"]) {
			expect(parsePeriod(raw), raw).toBeNull();
		}
	});
	it("periodKey devolve o texto de entrada", () => {
		for (const raw of ["all", "month:2026-02", "year:1999"]) expect(periodKey(parsePeriod(raw)!)).toBe(raw);
	});
});

describe("filtro por data da compra", () => {
	it("all não filtra; mês e ano usam intervalo de texto", () => {
		expect(dateFilter({ kind: "all" })).toEqual({});
		expect(dateFilter({ kind: "month", month: "2026-11" })).toEqual({ date: { $gte: "2026-11-01", $lte: "2026-11-31" } });
		expect(dateFilter({ kind: "year", year: "2026" })).toEqual({ date: { $gte: "2026-01-01", $lte: "2026-12-31" } });
	});
	it("inPeriod nas bordas", () => {
		const m = parsePeriod("month:2026-11")!;
		expect(["2026-10-31", "2026-11-01", "2026-11-30", "2026-12-01"].map((d) => inPeriod(d, m))).toEqual([false, true, true, false]);
		const y = parsePeriod("year:2026")!;
		expect(["2025-12-31", "2026-01-01", "2026-12-31", "2027-01-01"].map((d) => inPeriod(d, y))).toEqual([false, true, true, false]);
		expect(inPeriod("1999-01-01", { kind: "all" })).toBe(true);
	});
});
