import { describe, expect, it } from "vitest";
import { aboveLimitQuestion, hintLine, ifAllLine, inviteShareLine, myAnswerText, resultHeadline, scoreLines, summaryLine } from "./plans";

describe("textos do plano", () => {
	it("resultHeadline", () => {
		expect(resultHeadline({ fits: true, shareCents: 27778, includedCount: 9 })).toBe("Fecha com 9 pessoas · R$ 277,78 cada");
		expect(resultHeadline({ fits: true, shareCents: 250000, includedCount: 1 })).toBe("Fecha com 1 pessoa · R$ 2.500,00 cada");
		expect(resultHeadline({ fits: false, shareCents: null, includedCount: 0 })).toBe("Ainda não fecha");
	});
	it("hintLine", () => {
		expect(hintLine({ fits: false, hint: { extraPeople: 1, shareCents: 27778 } })).toBe("Com mais 1 pessoa fecha em R$ 277,78 para cada um.");
		expect(hintLine({ fits: false, hint: { extraPeople: 3, shareCents: 10000 } })).toBe("Com mais 3 pessoas fecha em R$ 100,00 para cada um.");
		expect(hintLine({ fits: true, hint: { extraPeople: 1, shareCents: 10000 } })).toBe("Com mais 1 pessoa cai para R$ 100,00 para cada um.");
		expect(hintLine({ fits: false, hint: null })).toBeNull();
	});
	it("ifAllLine usa a previsão do criador ou as pessoas do plano", () => {
		expect(ifAllLine({ expectedPeople: 10, allCount: 10, shareIfAllCents: 25000, peopleCount: 3 })).toBe("Se forem as 10 pessoas: R$ 250,00 para cada um");
		expect(ifAllLine({ expectedPeople: null, allCount: 4, shareIfAllCents: 62500, peopleCount: 4 })).toBe("Se todos os 4 forem: R$ 625,00 para cada um");
		expect(ifAllLine({ expectedPeople: null, allCount: 1, shareIfAllCents: 250000, peopleCount: 1 })).toBeNull();
		expect(ifAllLine({ expectedPeople: 10, allCount: 10, shareIfAllCents: null, peopleCount: 3 })).toBeNull();
	});
	it("scoreLines nunca mostra faltantes negativos", () => {
		expect(scoreLines({ answeredCount: 6, allCount: 10, missingCount: 4 })).toEqual({ answered: "6 de 10 já responderam", missing: "Faltam responder: 4" });
		expect(scoreLines({ answeredCount: 4, allCount: 4, missingCount: 0 })).toEqual({ answered: "4 de 4 já responderam", missing: null });
	});
	it("summaryLine", () => {
		const s = { goingCount: 8, includedCount: 8, shareCents: 31250, fits: true, status: "open" as const };
		expect(summaryLine(s)).toBe("8 vão · R$ 312,50 cada");
		expect(summaryLine({ ...s, includedCount: 1, shareCents: 100, fits: true })).toBe("1 vai · R$ 1,00 cada");
		expect(summaryLine({ ...s, fits: false, shareCents: null })).toBe("8 vão · Ainda não fecha");
		expect(summaryLine({ ...s, fits: false, shareCents: null, goingCount: 0 })).toBe("Ainda não fecha");
		expect(summaryLine({ ...s, status: "cancelled" })).toBe("Cancelado");
		expect(summaryLine({ ...s, status: "done" })).toBe("Virou grupo e despesa");
	});
	it("aboveLimitQuestion só existe com limite e parte conhecidos", () => {
		expect(aboveLimitQuestion({ name: "Ana", isYou: true, limitCents: 25000, shareIfIncludedCents: 27778 })).toBe(
			"Do jeito que está, sua parte seria R$ 277,78, acima do seu limite de R$ 250,00. Você vai ou não?",
		);
		expect(aboveLimitQuestion({ name: "Benjamim", isYou: false, limitCents: 20000, shareIfIncludedCents: 30000 })).toContain("a parte de Benjamim");
		expect(aboveLimitQuestion({ name: "Ana", isYou: true, limitCents: null, shareIfIncludedCents: 1 })).toBeNull();
	});
	it("myAnswerText", () => {
		expect(myAnswerText({ answer: "going", limitCents: 30000 })).toBe("Vou (até R$ 300,00)");
		expect(myAnswerText({ answer: "going", limitCents: null })).toBe("Vou (sem limite)");
		expect(myAnswerText({ answer: "not_going", limitCents: null })).toBe("Não vou");
		expect(myAnswerText({ answer: "pending", limitCents: null })).toBe("Ainda não respondeu");
	});
	it("inviteShareLine", () => {
		expect(inviteShareLine(10, 25000)).toBe("Se forem 10 pessoas, fica R$ 250,00 para cada um.");
		expect(inviteShareLine(1, 25000)).toBeNull();
		expect(inviteShareLine(10, null)).toBeNull();
	});
});
