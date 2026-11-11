import { describe, expect, it } from "vitest";
import {
	clampDay,
	createdFlash,
	dayHint,
	endLine,
	endPeriodProblem,
	firstDueDate,
	firstDueLine,
	nextDueLine,
	payerLine,
	periodLabel,
	recurrenceLine,
	recurrenceSummaryLine,
} from "./recurrences";

describe("firstDueDate", () => {
	it("usa este mês quando o dia ainda não passou", () => {
		expect(firstDueDate("2026-11-11", 25)).toBe("2026-11-25");
	});
	it("hoje conta como este mês", () => {
		expect(firstDueDate("2026-11-11", 11)).toBe("2026-11-11");
	});
	it("usa o mês que vem quando o dia já passou", () => {
		expect(firstDueDate("2026-11-11", 10)).toBe("2026-12-10");
	});
	it("vira o ano em dezembro", () => {
		expect(firstDueDate("2026-12-20", 5)).toBe("2027-01-05");
	});
	it("corta no fim do mês curto", () => {
		expect(firstDueDate("2026-11-11", 31)).toBe("2026-11-30");
		expect(firstDueDate("2027-02-01", 30)).toBe("2027-02-28");
		expect(firstDueDate("2028-02-01", 31)).toBe("2028-02-29");
	});
	it("dia 31 depois do fim do mês curto vai para o mês seguinte inteiro", () => {
		expect(firstDueDate("2026-01-31", 31)).toBe("2026-01-31");
		expect(firstDueDate("2026-04-30", 31)).toBe("2026-04-30");
		expect(firstDueDate("2026-03-31", 30)).toBe("2026-04-30");
	});
});

describe("clampDay", () => {
	it("limita a 1..31", () => {
		expect(clampDay(0)).toBe(1);
		expect(clampDay(40)).toBe(31);
		expect(clampDay(12.7)).toBe(12);
		expect(clampDay(Number.NaN)).toBe(10);
	});
});

describe("textos", () => {
	it("resumo e primeira data", () => {
		expect(recurrenceSummaryLine(25, 30000)).toBe("Todo dia 25, R$ 300,00");
		expect(firstDueLine("2026-11-25", "2026-11-11")).toBe("A primeira vence em 25 de novembro");
		expect(firstDueLine("2027-01-05", "2026-12-20")).toBe("A primeira vence em 5 de janeiro de 2027");
		expect(firstDueLine("", "2026-11-11")).toBe("");
	});
	it("aviso só para 29 a 31", () => {
		expect(dayHint(28)).toBeNull();
		expect(dayHint(29)).toContain("29");
		expect(dayHint(31)).toBe("Nos meses sem o dia 31, vale o último dia do mês.");
	});
	it("linhas da lista", () => {
		expect(recurrenceLine({ amountCents: 30000, dayOfMonth: 25 })).toBe("R$ 300,00 · todo dia 25");
		expect(nextDueLine("2026-12-25", "2026-11-11")).toBe("Próxima: 25 de dezembro");
		expect(nextDueLine("2027-01-25", "2026-11-11")).toBe("Próxima: 25 de janeiro de 2027");
		expect(endLine("2027-03")).toBe("até março de 2027");
		expect(endLine(null)).toBe("");
		expect(endLine("lixo")).toBe("");
		expect(periodLabel("2026-13")).toBe("");
	});
	it("quem paga", () => {
		expect(payerLine({ name: "Rafael", isYou: true })).toBe("Quem paga: você");
		expect(payerLine({ name: "Maria", isYou: false })).toBe("Quem paga: Maria");
		expect(payerLine({ name: "Benjamim", isYou: false, youManage: true })).toBe("Quem paga: Benjamim (você cuida)");
	});
	it("recado depois de criar", () => {
		expect(createdFlash("2026-12-10")).toBe("Despesa fixa criada. A primeira aparece em dezembro.");
	});
});

describe("endPeriodProblem", () => {
	it("sem fim está certo", () => {
		expect(endPeriodProblem(null, "2026-11-25")).toBeNull();
	});
	it("mês ainda não escolhido", () => {
		expect(endPeriodProblem("", "2026-11-25")).toBe("Escolha o mês em que termina.");
	});
	it("não pode ser antes do primeiro mês", () => {
		expect(endPeriodProblem("2026-10", "2026-11-25")).toBe("Escolha um mês a partir de novembro de 2026.");
		expect(endPeriodProblem("2026-11", "2026-11-25")).toBeNull();
		expect(endPeriodProblem("2027-03", "2026-11-25")).toBeNull();
	});
});
