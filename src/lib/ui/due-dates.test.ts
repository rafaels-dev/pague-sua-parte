import { describe, expect, it } from "vitest";
import {
	addMonthsClamped,
	buildInstallmentShareText,
	deleteFlashMessage,
	clampInstallments,
	dueLong,
	dueMonthsShort,
	dueShort,
	formatDueLong,
	formatDueNumeric,
	installmentSchedule,
	installmentTotalLine,
	isValidDueDate,
	monthName,
	nextDayOfMonth,
	nextMonthSameDay,
	seriesItemState,
	untilEndOfMonthLine,
	compactBalanceLine,
} from "./due-dates";

describe("addMonthsClamped", () => {
	it("corta no fim do mês curto", () => {
		expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
		expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
	});
	it("conta sempre a partir da data original", () => {
		expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
		expect(addMonthsClamped("2027-01-31", 3)).toBe("2027-04-30");
	});
	it("vira o ano", () => {
		expect(addMonthsClamped("2026-12-10", 1)).toBe("2027-01-10");
		expect(addMonthsClamped("2026-12-10", 13)).toBe("2028-01-10");
	});
	it("data inválida vira vazio", () => {
		expect(addMonthsClamped("2027-02-30", 1)).toBe("");
		expect(addMonthsClamped("abc", 1)).toBe("");
	});
});

describe("installmentSchedule", () => {
	it("mensal a partir da primeira data", () => {
		expect(installmentSchedule("2026-12-10", 4)).toEqual(["2026-12-10", "2027-01-10", "2027-02-10", "2027-03-10"]);
	});
	it("31 de janeiro: fevereiro corta e março volta ao 31", () => {
		expect(installmentSchedule("2027-01-31", 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
		expect(installmentSchedule("2028-01-31", 3)[1]).toBe("2028-02-29");
	});
	it("48 parcelas", () => {
		const s = installmentSchedule("2026-11-15", 48);
		expect(s).toHaveLength(48);
		expect(s[47]).toBe("2030-10-15");
	});
	it("entradas inválidas", () => {
		expect(installmentSchedule("", 3)).toEqual([]);
		expect(installmentSchedule("2026-12-10", 0)).toEqual([]);
	});
});

describe("clampInstallments", () => {
	it("mantém de 2 a 48", () => {
		expect(clampInstallments(1)).toBe(2);
		expect(clampInstallments(0)).toBe(2);
		expect(clampInstallments(-5)).toBe(2);
		expect(clampInstallments(49)).toBe(48);
		expect(clampInstallments(12)).toBe(12);
		expect(clampInstallments(Number.NaN)).toBe(2);
	});
});

describe("dueMonthsShort", () => {
	it("lista curta dos meses", () => {
		expect(dueMonthsShort(installmentSchedule("2026-12-10", 6))).toBe("dez, jan 27, fev, mar, abr, mai");
	});
	it("sem virada de ano não repete o ano", () => {
		expect(dueMonthsShort(installmentSchedule("2026-03-10", 4))).toBe("mar, abr, mai, jun");
	});
	it("resume quando passa de 12", () => {
		expect(dueMonthsShort(installmentSchedule("2026-12-10", 24))).toBe("dez 26 a nov 28");
	});
	it("vazio", () => expect(dueMonthsShort([])).toBe(""));
});

describe("installmentTotalLine", () => {
	it("multiplica e soma", () => expect(installmentTotalLine(6, 12000)).toBe("6 × R$ 120,00 = R$ 720,00"));
});

describe("formatação de vencimento", () => {
	const today = "2026-11-11";
	it("por extenso", () => {
		expect(formatDueLong("2026-12-10", today)).toBe("10 de dezembro");
		expect(formatDueLong("2027-01-10", today)).toBe("10 de janeiro de 2027");
	});
	it("numérico", () => {
		expect(formatDueNumeric("2026-12-10", today)).toBe("10/12");
		expect(formatDueNumeric("2027-01-05", today)).toBe("05/01/27");
	});
	it("nome do mês", () => expect(monthName("2026-11-11")).toBe("novembro"));
	it("dueLong", () => {
		expect(dueLong("2026-12-10", false, today)).toEqual({ text: "Vence em 10 de dezembro", overdue: false });
		expect(dueLong("2026-11-03", true, today)).toEqual({ text: "Venceu em 3 de novembro", overdue: true });
		expect(dueLong("2026-11-11", false, today)?.text).toBe("Vence em 11 de novembro");
		expect(dueLong(null, false, today)).toBeNull();
	});
	it("data passada, mas quitada, não fica em vermelho", () => {
		expect(dueLong("2026-10-10", false, today)).toEqual({ text: "Venceu em 10 de outubro", overdue: false });
	});
	it("dueShort", () => {
		expect(dueShort("2026-12-10", false, today)?.text).toBe("Vence 10/12");
		expect(dueShort("2026-11-10", true, today)).toEqual({ text: "Venceu 10/11", overdue: true });
		expect(dueShort(null, false, today)).toBeNull();
	});
});

describe("seriesItemState", () => {
	const today = "2026-11-11";
	it("paga, vencida ou em aberto", () => {
		expect(seriesItemState({ dueDate: "2026-10-10", settled: true }, today)).toBe("paid");
		expect(seriesItemState({ dueDate: "2026-10-10", settled: false }, today)).toBe("overdue");
		expect(seriesItemState({ dueDate: "2026-11-11", settled: false }, today)).toBe("open");
		expect(seriesItemState({ dueDate: "2026-12-10", settled: false }, today)).toBe("open");
	});
});

describe("atalhos de data", () => {
	it("próximo dia 10", () => {
		expect(nextDayOfMonth("2026-11-05", 10)).toBe("2026-11-10");
		expect(nextDayOfMonth("2026-11-10", 10)).toBe("2026-11-10");
		expect(nextDayOfMonth("2026-11-11", 10)).toBe("2026-12-10");
		expect(nextDayOfMonth("2026-12-20", 15)).toBe("2027-01-15");
	});
	it("dia 31 em mês curto", () => expect(nextDayOfMonth("2027-02-01", 31)).toBe("2027-02-28"));
	it("mês que vem", () => {
		expect(nextMonthSameDay("2026-11-11")).toBe("2026-12-11");
		expect(nextMonthSameDay("2027-01-31")).toBe("2027-02-28");
	});
});

describe("isValidDueDate", () => {
	it("aceita a partir do dia da compra", () => {
		expect(isValidDueDate("2026-12-10", "2026-11-11", "2026-11-11")).toBe(true);
		expect(isValidDueDate("2026-11-11", "2026-11-11", "2026-11-11")).toBe(true);
	});
	it("recusa antes da compra, data falsa e ano absurdo", () => {
		expect(isValidDueDate("2026-11-10", "2026-11-11", "2026-11-11")).toBe(false);
		expect(isValidDueDate("2026-02-30", "2026-01-01", "2026-11-11")).toBe(false);
		expect(isValidDueDate("2099-01-01", "2026-11-11", "2026-11-11")).toBe(false);
		expect(isValidDueDate("", "2026-11-11", "2026-11-11")).toBe(false);
	});
});

describe("buildInstallmentShareText", () => {
	it("frase de parcelas", () => {
		expect(buildInstallmentShareText({ amountCents: 12000, description: "Sofá ", installmentCount: 6 }, "L")).toBe(
			"Paguei uma nova despesa de 6 parcelas de R$ 120,00, referente a Sofá. Abra o link e pague sua parte. L",
		);
	});
});

describe("untilEndOfMonthLine e compactBalanceLine", () => {
	const today = "2026-11-11";
	const base = { toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 };
	it("só aparece quando difere do total", () => {
		expect(untilEndOfMonthLine(10000, 10000, today)).toBeNull();
		expect(untilEndOfMonthLine(10000, 4000, today)).toBe("R$ 40,00 até o fim de novembro");
		expect(untilEndOfMonthLine(10000, 0, today)).toBe("R$ 0,00 até o fim de novembro");
	});
	it("uma linha só, vencido primeiro", () => {
		expect(compactBalanceLine({ ...base, toPayCents: 9000, toPayNowCents: 3000, overdueToPayCents: 500 })).toEqual({ text: "R$ 5,00 vencido", tone: "error" });
		expect(compactBalanceLine({ ...base, toPayCents: 9000, toPayNowCents: 3000 })).toEqual({ text: "A pagar R$ 30,00 neste mês", tone: "muted" });
		expect(compactBalanceLine({ ...base, toReceiveCents: 9000, toReceiveNowCents: 1000 })?.text).toBe("A receber R$ 10,00 neste mês");
		expect(compactBalanceLine({ ...base, toPayCents: 100, toPayNowCents: 100 })).toBeNull();
	});
});

describe("deleteFlashMessage", () => {
	it("só esta", () => {
		expect(deleteFlashMessage({ scope: "this", installment: false })).toBe("Despesa apagada.");
		expect(deleteFlashMessage({ scope: "this", installment: true })).toBe("Parcela apagada.");
	});
	it("esta e as próximas", () => {
		expect(deleteFlashMessage({ scope: "following", installment: true, deleted: 4, kept: 0 })).toBe("4 parcelas apagadas.");
		expect(deleteFlashMessage({ scope: "following", installment: true, deleted: 1, kept: 0 })).toBe("1 parcela apagada.");
		expect(deleteFlashMessage({ scope: "following", installment: true, deleted: 3, kept: 2 })).toBe("3 parcelas apagadas. 2 mantidas porque já têm pagamento.");
		expect(deleteFlashMessage({ scope: "following", installment: true, deleted: 3, kept: 1 })).toBe("3 parcelas apagadas. 1 mantida porque já tem pagamento.");
	});
	it("resposta sem números não quebra", () => {
		expect(deleteFlashMessage({ scope: "following", installment: true })).toBe("1 parcela apagada.");
	});
});
