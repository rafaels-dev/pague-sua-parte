import { describe, expect, it } from "vitest";
import { addMonthsClamped, installmentDueDates, isDueNow, isPastDue, lastDayOfMonth, todayInSaoPaulo } from "./dates";

describe("addMonthsClamped", () => {
	it("mantém o dia quando o mês comporta", () => {
		expect(addMonthsClamped("2026-03-15", 0)).toBe("2026-03-15");
		expect(addMonthsClamped("2026-03-15", 1)).toBe("2026-04-15");
	});
	it("31 de janeiro: fevereiro (28 e 29) e volta a 31 em março, sempre a partir da data original", () => {
		expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
		expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29"); // bissexto
		expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31"); // não encadeia 28 -> 28
		expect(addMonthsClamped("2027-01-31", 3)).toBe("2027-04-30");
	});
	it("29 e 30 de janeiro também limitam em fevereiro", () => {
		expect(addMonthsClamped("2027-01-30", 1)).toBe("2027-02-28");
		expect(addMonthsClamped("2027-01-29", 1)).toBe("2027-02-28");
		expect(addMonthsClamped("2028-01-29", 1)).toBe("2028-02-29");
	});
	it("29 de fevereiro de ano bissexto: 12 meses depois vira 28/02", () => {
		expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
		expect(addMonthsClamped("2028-02-29", 48)).toBe("2032-02-29");
	});
	it("vira o ano", () => {
		expect(addMonthsClamped("2026-11-10", 2)).toBe("2027-01-10");
		expect(addMonthsClamped("2026-12-31", 2)).toBe("2027-02-28");
		expect(addMonthsClamped("2026-12-31", 14)).toBe("2028-02-29");
	});
});

describe("installmentDueDates", () => {
	it("n parcelas, cada uma a partir da primeira data", () => {
		expect(installmentDueDates("2027-01-31", 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
		expect(installmentDueDates("2027-05-10", 2)).toEqual(["2027-05-10", "2027-06-10"]);
	});
	it("48 parcelas", () => {
		const d = installmentDueDates("2026-11-30", 48);
		expect(d).toHaveLength(48);
		expect(d[47]).toBe("2030-10-30");
		expect(new Set(d).size).toBe(48);
	});
});

describe("lastDayOfMonth / isDueNow / isPastDue", () => {
	it("último dia do mês", () => {
		expect(lastDayOfMonth("2026-11-11")).toBe("2026-11-30");
		expect(lastDayOfMonth("2028-02-01")).toBe("2028-02-29");
		expect(lastDayOfMonth("2027-02-10")).toBe("2027-02-28");
		expect(lastDayOfMonth("2026-12-05")).toBe("2026-12-31");
	});
	it("agora = sem vencimento ou até o fim do mês de hoje", () => {
		expect(isDueNow(undefined, "2026-11-11")).toBe(true);
		expect(isDueNow(null, "2026-11-11")).toBe(true);
		expect(isDueNow("2026-10-01", "2026-11-11")).toBe(true);
		expect(isDueNow("2026-11-30", "2026-11-11")).toBe(true);
		expect(isDueNow("2026-12-01", "2026-11-11")).toBe(false);
	});
	it("atrasado = vencimento antes de hoje (hoje ainda não está atrasado)", () => {
		expect(isPastDue("2026-11-10", "2026-11-11")).toBe(true);
		expect(isPastDue("2026-11-11", "2026-11-11")).toBe(false);
		expect(isPastDue(undefined, "2026-11-11")).toBe(false);
	});
});

describe("todayInSaoPaulo", () => {
	it("vira o dia às 03:00 UTC (UTC-3)", () => {
		expect(todayInSaoPaulo(new Date("2026-11-12T02:59:59Z"))).toBe("2026-11-11");
		expect(todayInSaoPaulo(new Date("2026-11-12T03:00:00Z"))).toBe("2026-11-12");
	});
});
