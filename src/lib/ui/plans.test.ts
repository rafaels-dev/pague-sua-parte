import { describe, expect, it } from "vitest";
import { minPeopleForLimit } from "@/lib/plans/compute";
import { goalLines, inviteGoal, initialLimitCents, limitNote, liveLimitNote, goingBody, limitHint, limitIntro, PLANNED_LABEL, plannedSupport, suggestedLimit, limitPlaceholder, hintLine, ifAllLine, inviteShareLine, myAnswerText, resultHeadline, scoreLines, summaryLine } from "./plans";

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
	it("summaryLine: plano aberto mostra a meta, nunca o placar de agora", () => {
		const s = { status: "open" as const, hasExpense: false, expectedPeople: 13, allCount: 13, shareIfAllCents: 21924, peopleCount: 2 };
		expect(summaryLine(s)).toBe("Meta: 13 pessoas · R$ 219,24 cada");
		expect(summaryLine({ ...s, expectedPeople: null, allCount: 2, shareIfAllCents: 142500 })).toBe("2 pessoas no plano");
		expect(summaryLine({ ...s, expectedPeople: null, allCount: 1, peopleCount: 1 })).toBe("1 pessoa no plano");
		expect(summaryLine({ ...s, shareIfAllCents: null })).toBe("2 pessoas no plano");
		expect(summaryLine(s)).not.toMatch(/vai|vão|fecha/i);
		expect(summaryLine({ ...s, status: "cancelled" })).toBe("Cancelado");
		expect(summaryLine({ ...s, status: "done", hasExpense: true })).toBe("Virou grupo e despesa");
		expect(summaryLine({ ...s, status: "done", hasExpense: false })).toBe("Virou grupo");
	});
	it("frase ao vivo: só quando o limite digitado fica abaixo da parte de hoje", () => {
		const ana = { name: "Ana", isYou: true, answer: "pending" as const };
		// 100000, 4 já confirmaram + ela = 5 -> 200,00; limite 150,00 -> K=7
		expect(liveLimitNote(ana, 15000, 100000, 4)).toContain("pelo menos 7 pessoas");
		expect(liveLimitNote(ana, 20000, 100000, 4)).toBeNull(); // igual à parte de hoje
		expect(liveLimitNote(ana, 0, 100000, 4)).toBeNull();
		// quem já disse Vou conta uma vez só: 4 confirmadas incluindo ela
		expect(liveLimitNote({ ...ana, answer: "going" }, 15000, 100000, 4)).toContain("pelo menos 7 pessoas");
		expect(liveLimitNote({ ...ana, answer: "going" }, 25000, 100000, 4)).toBeNull(); // 4 pessoas = 250,00
	});
	describe("limitNote", () => {
		const you = { name: "Ana", isYou: true };
		it("para você e para pessoa sem celular, sem o valor de hoje", () => {
			expect(limitNote(you, 30000, 285000)).toBe("No valor limite que você pode pagar, você entra na divisão quando pelo menos 10 pessoas confirmarem.");
			expect(limitNote({ name: "Benjamim", isYou: false }, 30000, 285000)).toBe(
				"No valor limite que Benjamim pode pagar, Benjamim entra na divisão quando pelo menos 10 pessoas confirmarem.",
			);
			expect(limitNote(you, 30000, 285000)).not.toMatch(/R\$|mesmo assim|vai ou não/);
		});
		it("fronteira com centavos que não dividem certo", () => {
			// 285001 / 10 = 28500,1 -> a maior parte é 28501
			expect(limitNote(you, 28500, 285001)).toContain("pelo menos 11 pessoas");
			expect(limitNote(you, 28501, 285001)).toContain("pelo menos 10 pessoas");
			expect(minPeopleForLimit(285001, 28501, 50)).toBe(10);
			expect(minPeopleForLimit(285001, 28500, 50)).toBe(11);
		});
		it("acima do teto de 50 pessoas", () => {
			expect(limitNote(you, 5000, 285000)).toBe("Esse limite fica abaixo da parte mesmo com o plano cheio.");
			expect(limitNote(you, 5700, 285000)).toContain("pelo menos 50 pessoas");
		});
		it("sem limite ou limite que já cobre tudo: sem frase", () => {
			expect(limitNote(you, null, 285000)).toBeNull();
			expect(limitNote(you, 0, 285000)).toBeNull();
			expect(limitNote(you, 285000, 285000)).toBeNull();
		});
	});
	it("campo de limite: pré-preenche a sugestão só com previsão do organizador e só para quem ainda não disse Vou", () => {
		const expected = { cents: 25000, basis: "expected" as const, people: 10 };
		expect(initialLimitCents({ answer: "pending", limitCents: null, preview: expected }, 250000)).toBe(31250);
		expect(initialLimitCents({ answer: "not_going", limitCents: null, preview: expected }, 250000)).toBe(31250);
		expect(initialLimitCents({ answer: "going", limitCents: null, preview: expected }, 250000)).toBe(0); // escolheu ficar sem limite
		expect(initialLimitCents({ answer: "going", limitCents: 30000, preview: expected }, 250000)).toBe(30000);
		expect(initialLimitCents({ answer: "pending", limitCents: null, preview: { cents: 1, basis: "plan", people: 3 } }, 250000)).toBe(0);
		expect(initialLimitCents({ answer: "pending", limitCents: null, preview: null }, 250000)).toBe(0);
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

describe("indicativo do limite", () => {
	const expected = { cents: 25000, basis: "expected" as const, people: 10 };
	const today = { cents: 27778, basis: "today" as const, people: 9 };
	const plan = { cents: 50000, basis: "plan" as const, people: 5 };
	it("placeholder é o valor previsto, sempre com R$; sem previsão, R$ 0,00", () => {
		expect(limitPlaceholder(expected)).toBe("R$ 250,00");
		expect(limitPlaceholder(null)).toBe("R$ 0,00");
	});
	it("pergunta acima do campo, campo planejado e apoio abaixo", () => {
		const you = { name: "Ana", isYou: true };
		const guest = { name: "Benjamim", isYou: false };
		expect(limitIntro(expected, you)).toBe("Se alguém faltar, a parte de cada um aumenta. Até quanto você pode pagar na nova divisão?");
		expect(limitIntro(expected, guest)).toContain("Até quanto Benjamim pode pagar na nova divisão?");
		for (const p of [plan, today, null]) expect(limitIntro(p, you)).toBe("Se menos gente for, a parte de cada um aumenta. Até quanto você pode pagar?");
		expect(limitIntro(null, guest)).toBe("Se menos gente for, a parte de cada um aumenta. Até quanto Benjamim pode pagar?");
		expect(PLANNED_LABEL).toBe("Valor planejado por pessoa");
		expect(plannedSupport(expected)).toBe("Se todo mundo confirmar (10 pessoas).");
	});
	it("sugestão: parte se 20% das pessoas previstas não forem", () => {
		const e = (n: number) => ({ cents: 0, basis: "expected" as const, people: n });
		// R$ 2.850,00: E=10 -> 8 pessoas -> 356,25
		expect(suggestedLimit(e(10), 285000)).toEqual({ cents: 35625, absent: 2, people: 10 });
		// pessoas: E=1 -> 1, E=2 -> 2, E=3 -> 2, E=5 -> 4
		expect(suggestedLimit(e(1), 285000)).toMatchObject({ cents: 285000, absent: 0 });
		expect(suggestedLimit(e(2), 285000)).toMatchObject({ cents: 142500, absent: 0 });
		expect(suggestedLimit(e(3), 285000)).toMatchObject({ cents: 142500, absent: 1 });
		expect(suggestedLimit(e(5), 285000)).toMatchObject({ cents: 71250, absent: 1 });
		// centavos que não dividem: 100001 / 8 = 12500,125 -> a maior parte é 12501
		expect(suggestedLimit(e(10), 100001)?.cents).toBe(12501);
		expect(suggestedLimit(plan, 285000)).toBeNull();
		expect(suggestedLimit(null, 285000)).toBeNull();
	});
	it("apoio do campo: sugestão quando alguém 'sai' na conta; senão só o básico", () => {
		const e = (n: number) => ({ cents: 0, basis: "expected" as const, people: n });
		expect(limitHint(e(10), 285000)).toBe("Sugestão: R$ 356,25, se 2 das 10 pessoas não forem. Pode mudar, ou apagar se não tem limite.");
		expect(limitHint(e(2), 285000)).toBe("Pode mudar, ou apagar se não tem limite.");
		expect(limitHint(plan, 285000)).toBe("Pode mudar, ou apagar se não tem limite.");
		expect(limitHint(null, 285000)).toBe("Pode mudar, ou apagar se não tem limite.");
	});
	it("enviar sem digitar não grava limite: o placeholder nunca vira valor", () => {
		expect(goingBody(0)).toEqual({ going: true });
		expect("limitCents" in goingBody(0)).toBe(false);
		expect(goingBody(18000)).toEqual({ going: true, limitCents: 18000 });
	});
});

describe("meta do plano (tela de quem responde)", () => {
	it("mostra a meta e a parte se só 80% forem", () => {
		expect(goalLines({ expectedPeople: 13, allCount: 13, shareIfAllCents: 21924 }, 285000)).toEqual({ goal: "13 pessoas · R$ 219,24 cada", lower: "Se só 10 forem: R$ 285,00 para cada um" });
	});
	it("previsão pequena: sem a linha dos 80%", () => {
		expect(goalLines({ expectedPeople: 2, allCount: 2, shareIfAllCents: 50000 }, 100000)).toEqual({ goal: "2 pessoas · R$ 500,00 cada", lower: null });
	});
	it("entrou mais gente que o previsto: a meta e os 80% saem de quem está no plano", () => {
		expect(goalLines({ expectedPeople: 10, allCount: 14, shareIfAllCents: 20358 }, 285000)).toEqual({ goal: "14 pessoas · R$ 203,58 cada", lower: "Se só 11 forem: R$ 259,10 para cada um" });
	});
	it("previsão de 1 pessoa: sem a linha dos 80%", () => {
		expect(goalLines({ expectedPeople: 1, allCount: 1, shareIfAllCents: 100000 }, 100000)?.lower).toBeNull();
	});
	it("sem previsão de pessoas não há meta", () => {
		expect(goalLines({ expectedPeople: null, allCount: 4, shareIfAllCents: 25000 }, 100000)).toBeNull();
	});
	it("nunca fala de quem já confirmou nem do valor de hoje", () => {
		const g = goalLines({ expectedPeople: 13, allCount: 13, shareIfAllCents: 21924 }, 285000)!;
		expect(`${g.goal} ${g.lower}`).not.toMatch(/Fecha|Por enquanto|2\.850/);
	});
});

describe("valor por pessoa na página do convite", () => {
	it("divisão, parte de cada um e o valor se só 80% confirmarem", () => {
		expect(inviteGoal({ totalCents: 285000, allCount: 13, shareIfAllCents: 21924 })).toEqual({
			split: "R$ 2.850,00 dividido por 13 pessoas",
			shareCents: 21924,
			lower: "Se só 10 confirmarem, o valor muda para R$ 285,00.",
		});
	});
	it("2 pessoas: sem a linha dos 80%", () => {
		expect(inviteGoal({ totalCents: 100000, allCount: 2, shareIfAllCents: 50000 })?.lower).toBeNull();
	});
	it("sem valor por pessoa: 1 pessoa ou parte nula", () => {
		expect(inviteGoal({ totalCents: 100000, allCount: 1, shareIfAllCents: 100000 })).toBeNull();
		expect(inviteGoal({ totalCents: 3, allCount: 10, shareIfAllCents: null })).toBeNull();
	});
});
