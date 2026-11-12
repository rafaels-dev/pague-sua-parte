import { describe, expect, it } from "vitest";
import { buildGroupLink, buildGroupSummaryText, normalizeGroupSummary, SUMMARY_MAX_CHARS, SUMMARY_MAX_LINES, type GroupSummaryData, type SummaryExpense } from "./group-summary";

const LINK = "https://pague-sua-parte.app/app/grupos/g1";
const base: GroupSummaryData = {
	groupName: "Família Silva",
	totalOpenCents: 35000,
	overdueCents: 12000,
	debts: [
		{ fromName: "Carlos", toName: "Bruno", cents: 8000, overdue: false, refund: false },
		{ fromName: "Ana", toName: "Bruno", cents: 12000, overdue: true, refund: false },
		{ fromName: "Ana", toName: "Carla", cents: 3000, overdue: false, refund: false },
		{ fromName: "Bruno", toName: "Dora", cents: 1500, overdue: false, refund: true },
	],
	moreDebts: 0,
	upToDate: ["Dora", "Eva"],
	moreUpToDate: 0,
	expenses: [],
	moreExpenses: 0,
	upcoming: [],
	moreUpcoming: 0,
	upcomingTotalCents: 0,
};

describe("buildGroupSummaryText", () => {
	it("título, total, quem deve a quem (atrasado marcado), devolução, quem está em dia e o link", () => {
		expect(buildGroupSummaryText(base, LINK)).toBe(
			[
				"*Resumo do grupo Família Silva*",
				"Ainda em aberto: *R$ 350,00*",
				"Atrasado: R$ 120,00",
				"",
				"Ana deve R$ 120,00 a Bruno (atrasado)",
				"Ana deve R$ 30,00 a Carla",
				"Bruno devolve R$ 15,00 para Dora",
				"Carlos deve R$ 80,00 a Bruno",
				"",
				"Em dia: Dora e Eva",
				"",
				`Veja os detalhes: ${LINK}`,
			].join("\n"),
		);
	});
	it("sem dívidas: tudo certo", () => {
		const t = buildGroupSummaryText({ ...base, totalOpenCents: 0, debts: [], overdueCents: 0 }, LINK);
		expect(t).toContain("Tudo certo: ninguém deve nada.");
		expect(t).not.toContain("Ainda em aberto");
	});
	it("corta em N linhas e diz 'e mais N' (inclui as que o servidor já cortou)", () => {
		const debts = Array.from({ length: 30 }, (_, i) => ({ fromName: `P${String(i).padStart(2, "0")}`, toName: "Z", cents: 100, overdue: false, refund: false }));
		const t = buildGroupSummaryText({ ...base, debts, moreDebts: 5 }, LINK);
		expect(t.split("\n").filter((l) => l.includes(" deve R$")).length).toBe(SUMMARY_MAX_LINES);
		expect(t).toContain(`e mais ${30 - SUMMARY_MAX_LINES + 5}`);
	});
	it("nunca inclui chave Pix: só os campos de nome e valor entram no texto", () => {
		const raw = { ...base, debts: [{ ...base.debts[0], pixKey: "segredo@x.com" }], pix: { key: "52998224725" } };
		expect(buildGroupSummaryText(normalizeGroupSummary(raw), LINK)).not.toMatch(/segredo|52998224725/);
	});
	it("normaliza resposta torta e monta o link do grupo", () => {
		expect(normalizeGroupSummary(null)).toMatchObject({ groupName: "Grupo", debts: [], totalOpenCents: 0, upToDate: [] });
		expect(normalizeGroupSummary({ debts: [{ cents: 0 }, null, { fromName: "A", toName: "B", cents: 5 }] }).debts).toHaveLength(1);
		expect(buildGroupLink("https://x.app/", "g 1")).toBe("https://x.app/app/grupos/g%201");
	});
	it("resumo incompleto: avisa, nunca imprime 'Em dia' nem 'Tudo certo'", () => {
		const t = buildGroupSummaryText({ ...base, partial: true }, LINK);
		expect(t).toContain("Em aberto (parcial): *R$ 350,00*");
		expect(t).toContain("resumo incompleto");
		expect(t).not.toContain("Em dia");
		const none = buildGroupSummaryText({ ...base, partial: true, debts: [], totalOpenCents: 0 }, LINK);
		expect(none).not.toContain("Tudo certo");
		expect(none).not.toContain("Em dia");
		expect(normalizeGroupSummary({ partial: true }).partial).toBe(true);
		expect(normalizeGroupSummary({}).partial).toBe(false);
	});
});

let seq = 0;
const exp = (over: Partial<SummaryExpense> = {}): SummaryExpense => ({ id: `e${++seq}`, description: "Mercado do mês", totalCents: 62000, paidByName: "Maria", dueDate: null, overdue: false, owes: [{ name: "Rafael", cents: 15500 }], moreOwes: 0, refunds: [], moreRefunds: 0, ...over });
const withLists: GroupSummaryData = {
	...base,
	totalOpenCents: 71000,
	overdueCents: 31000,
	debts: [{ fromName: "Rafael", toName: "Maria", cents: 66000, overdue: true, refund: false }, { fromName: "Maria", toName: "Ana", cents: 5000, overdue: false, refund: true }],
	upToDate: ["Dora"],
	expenses: [
		exp({ dueDate: "2026-11-05", overdue: true, owes: [{ name: "Rafael", cents: 15500 }, { name: "José", cents: 15500 }] }),
		exp({ id: "consulta", description: "Consulta", totalCents: 45000, paidByName: "Rafael", dueDate: "2026-11-20", owes: [{ name: "José", cents: 15000 }], refunds: [{ name: "Maria das Dores", cents: 5000 }] }),
	],
	upcoming: [{ id: "consulta", dueDate: "2026-11-20", description: "Consulta", paidByName: "Rafael", owes: [{ name: "José", cents: 15000 }], moreOwes: 0 }],
	upcomingTotalCents: 15000,
};

describe("buildGroupSummaryText: despesas em aberto e próximos 15 dias", () => {
	it("formato completo: pagamentos do período, despesas (pagamento parcial = o que falta, devolução em linha própria) e quem deve a quem", () => {
		expect(buildGroupSummaryText(withLists, LINK).split("\n")).toEqual([
			"*Resumo do grupo Família Silva*",
			"Ainda em aberto: *R$ 710,00*",
			"Atrasado: R$ 310,00",
			"",
			"*Pagamentos para os próximos 15 dias:* R$ 150,00",
			"20/11 — Consulta: R$ 150,00 de José (para Rafael)",
			"",
			"*Despesas em aberto*",
			"• Mercado do mês — R$ 620,00, pago por Maria (venceu em 05/11)",
			"  Falta: R$ 155,00 de Rafael, R$ 155,00 de José",
			"• Consulta — R$ 450,00, pago por Rafael (vence em 20/11)",
			"  Falta: R$ 150,00 (veja acima)",
			"  Devolver: R$ 50,00 para Maria das Dores",
			"",
			"*Quem deve a quem*",
			"Maria devolve R$ 50,00 para Ana",
			"Rafael deve R$ 660,00 a Maria (atrasado)",
			"",
			"Em dia: Dora",
			"",
			`Veja os detalhes: ${LINK}`,
		]);
	});
	it("seção dos 15 dias some quando vazia; despesas sem nada de especial não mostram data", () => {
		const t = buildGroupSummaryText({ ...withLists, upcoming: [], upcomingTotalCents: 0, expenses: [exp()] }, LINK);
		expect(t).not.toContain("próximos 15 dias");
		expect(t).toContain("• Mercado do mês — R$ 620,00, pago por Maria\n  Falta: R$ 155,00 de Rafael");
		expect(t).not.toContain("venceu");
	});
	it("o total do cabeçalho é a soma do que a seção de despesas mostra (sem compensação entre duplas, nada cortado)", () => {
		const d: GroupSummaryData = {
			...withLists,
			totalOpenCents: 31000 + 20000,
			debts: [],
			expenses: [exp({ owes: [{ name: "Rafael", cents: 15500 }, { name: "José", cents: 15500 }] }), exp({ description: "Consulta", owes: [{ name: "José", cents: 15000 }], refunds: [{ name: "Ana", cents: 5000 }] })],
			upcoming: [],
		};
		const shown = d.expenses.flatMap((e) => [...e.owes, ...e.refunds]).reduce((t, p) => t + p.cents, 0);
		expect(shown).toBe(d.totalOpenCents);
	});
	it("limites: no máximo 15 despesas no texto, 6 pessoas por linha, e 'e mais N'", () => {
		const many = Array.from({ length: 20 }, (_, i) => exp({ description: `Despesa ${i + 1}`, dueDate: null }));
		const t = buildGroupSummaryText({ ...withLists, upcoming: [], expenses: many, moreExpenses: 3 }, LINK);
		expect(t.match(/^• /gm)).toHaveLength(15);
		expect(t).toContain("e mais 8 despesas"); // 5 que sobraram do texto + 3 do servidor
		const crowd = Array.from({ length: 8 }, (_, i) => ({ name: `Pessoa ${i + 1}`, cents: 100 }));
		const t2 = buildGroupSummaryText({ ...withLists, upcoming: [], expenses: [exp({ owes: crowd, moreOwes: 2 })] }, LINK);
		expect(t2).toContain("R$ 1,00 de Pessoa 6 e mais 4");
		expect(t2).not.toContain("Pessoa 7");
	});
	it("texto grande: corta as despesas primeiro e diz quantas ficaram de fora; totais ficam; cabe em 3500 caracteres", () => {
		const long = Array.from({ length: 40 }, (_, i) => exp({ description: `Despesa com nome bem comprido número ${i + 1} do mês`, owes: Array.from({ length: 6 }, (_, k) => ({ name: `Fulano de Tal ${k + 1}`, cents: 12345 })), dueDate: "2026-11-05", overdue: true }));
		const ups = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, dueDate: "2026-11-20", description: `Pagamento ${i + 1}`, paidByName: "Rafael", owes: [{ name: "José", cents: 1500 }], moreOwes: 0 }));
		const t = buildGroupSummaryText({ ...withLists, expenses: long, upcoming: ups, upcomingTotalCents: 18000 }, LINK);
		expect(t.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
		expect(t).toContain("Ainda em aberto: *R$ 710,00*");
		expect(t).toMatch(/e mais \d+ despesas/);
		expect(t).toContain("*Pagamentos para os próximos 15 dias:* R$ 180,00");
		expect(t).toContain(`Veja os detalhes: ${LINK}`);
	});
	it("tudo gigante: os pagamentos do período também encolhem, o total nunca sai", () => {
		const ups = Array.from({ length: 40 }, (_, i) => ({ id: `u${i}`, dueDate: "2026-11-20", description: `Pagamento com um nome muito grande para encher o texto ${i + 1}`, paidByName: "Rafael Schettino", owes: Array.from({ length: 6 }, (_, k) => ({ name: `Fulano de Tal ${k + 1}`, cents: 12345 })), moreOwes: 0 }));
		const t = buildGroupSummaryText({ ...withLists, expenses: [], upcoming: ups, upcomingTotalCents: 99999 }, LINK);
		expect(t.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
		expect(t).toMatch(/e mais \d+ pagamentos/);
		expect(t).toContain("Ainda em aberto");
	});
	it("duas despesas com o mesmo título e vencimento: só a que está na lista de cima é compactada (casa por código, não por título)", () => {
		const a = exp({ id: "a", description: "Luz", dueDate: "2026-11-20", owes: [{ name: "José", cents: 1000 }] });
		const b = exp({ id: "b", description: "Luz", dueDate: "2026-11-20", owes: [{ name: "Ana", cents: 2000 }] });
		const up = { id: "a", dueDate: "2026-11-20", description: "Luz", paidByName: "Maria", owes: [{ name: "José", cents: 1000 }], moreOwes: 0 };
		const t = buildGroupSummaryText({ ...withLists, expenses: [a, b], upcoming: [up], upcomingTotalCents: 1000 }, LINK);
		expect(t).toContain("  Falta: R$ 10,00 (veja acima)");
		expect(t).toContain("  Falta: R$ 20,00 de Ana");
		expect(t).not.toMatch(/\ba\b.*\bb\b/);
	});
	it("seção cortada até zero linhas não imprime título: vira uma linha 'Não coube aqui'", () => {
		// 40 pagamentos enormes e nenhuma despesa cabem só até o limite; força o corte até zero com um texto gigante de dívidas
		const big = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, fromName: `Pessoa com nome muito comprido ${i}`, toName: `Outra pessoa de nome bem comprido ${i}`, cents: 100 + i, overdue: false, refund: false }));
		const ups = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, dueDate: "2026-11-20", description: `Pagamento ${i}`, paidByName: "Rafael", owes: [{ name: "José", cents: 1500 }], moreOwes: 0 }));
		const manyExp = Array.from({ length: 15 }, () => exp({ owes: Array.from({ length: 6 }, (_, k) => ({ name: `Fulano de Tal ${k}`, cents: 12345 })) }));
		const t = buildGroupSummaryText({ ...withLists, debts: big.map(({ id, ...d }) => (void id, d)), moreDebts: 0, expenses: manyExp, upcoming: ups, upcomingTotalCents: 18000 }, LINK, 40);
		expect(t.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
		expect(t).toMatch(/Não coube aqui: .*despesas em aberto/);
		expect(t).not.toContain("*Despesas em aberto*");
		const lines = t.split("\n");
		lines.forEach((l, i) => {
			if (l.startsWith("*") && l !== lines[0] && !l.startsWith("*Resumo")) {
				// todo título é seguido de uma linha de conteúdo, nunca de linha vazia, fim ou outro título
				expect(lines[i + 1] ?? "").not.toBe("");
				expect(lines[i + 1] ?? "").not.toMatch(/^\*/);
			}
			if (l.startsWith("e mais")) expect(lines[i - 1]).not.toBe("");
		});
	});
	it("sem dívidas pairwise mas com despesas: não imprime 'Quem deve a quem' vazio", () => {
		const t = buildGroupSummaryText({ ...withLists, debts: [], moreDebts: 0 }, LINK);
		expect(t).not.toContain("Quem deve a quem");
	});
	it("resumo parcial continua sem 'Em dia' e com o aviso, mesmo com despesas", () => {
		const t = buildGroupSummaryText({ ...withLists, partial: true }, LINK);
		expect(t).toContain("Em aberto (parcial)");
		expect(t).not.toContain("Em dia:");
		expect(t).toContain("Atenção: resumo incompleto");
	});
	it("normalizeGroupSummary tolera resposta antiga e descarta linhas zeradas", () => {
		const old = normalizeGroupSummary({ groupName: "G", totalOpenCents: 100, debts: [] });
		expect(old).toMatchObject({ expenses: [], upcoming: [], moreExpenses: 0, upcomingTotalCents: 0 });
		const n = normalizeGroupSummary({ expenses: [{ description: "X", totalCents: 10, paidByName: "A", owes: [{ name: "B", cents: 0 }], refunds: [] }, { description: "Y", totalCents: 10, paidByName: "A", owes: [{ name: "B", cents: 5 }] }] });
		expect(n.expenses.map((e) => e.description)).toEqual(["Y"]);
	});
});
