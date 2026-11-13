import { describe, expect, it } from "vitest";
import { buildAdvanceNotices } from "./messages";
import type { AdvanceFact, NoticeContext } from "./types";

const G = "507f1f77bcf86cd799439011";
const E = "507f1f77bcf86cd799439012";
const members = [
	{ uid: "adm", role: "admin" as const },
	{ uid: "ana", role: "member" as const },
	{ uid: "bia", role: "member" as const },
	{ uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "ana", name: "Vó Lia" },
];
const NAMES: Record<string, string> = { adm: "Admin", ana: "Ana", bia: "Bia", m_vo: "Vó Lia" };
const ctx: NoticeContext = { group: (id) => (id === G ? { name: "Família", members } : undefined), name: (_g, uid) => NAMES[uid] ?? "Alguém" };
const items = [
	{ number: 1, cents: 10000, settled: true, remainingCents: 0 },
	{ number: 2, cents: 10000, settled: true, remainingCents: 0 },
	{ number: 3, cents: 10000, settled: true, remainingCents: 0 },
	{ number: 4, cents: 4700, settled: false, remainingCents: 5300 },
];
const fact = (over: Partial<AdvanceFact> = {}): AdvanceFact => ({ groupId: G, expenseId: E, description: "Sofá", paidBy: "bia", debtorUid: "ana", actorUid: "ana", manual: false, totalCents: 34700, items, ...over });

describe("aviso de adiantamento", () => {
	it("um só aviso para quem recebe, com o resumo das parcelas, sem chave Pix e levando à despesa", () => {
		const n = buildAdvanceNotices(fact(), ctx);
		expect(n).toHaveLength(1);
		expect(n[0]).toEqual({
			uid: "bia",
			title: "Adiantamento recebido",
			subject: 'Ana adiantou R$ 347,00 em "Sofá"',
			body: 'Ana adiantou R$ 347,00 em "Sofá" (Família): parcelas 1 a 3 pagas e R$ 47,00 da parcela 4.',
			url: `/app/grupos/${G}/despesas/${E}`,
			scope: { kind: "group", name: "Família" },
			amountCents: 34700,
			amountLabel: "Valor adiantado",
		});
		expect(JSON.stringify(n)).not.toMatch(/pix/i);
	});

	it("nunca avisa quem agiu: quem pagou a despesa registrando não recebe o próprio aviso", () => {
		const n = buildAdvanceNotices(fact({ actorUid: "bia", manual: true }), ctx);
		expect(n.map((x) => x.uid)).toEqual(["ana"]); // o devedor é avisado, quem agiu não
		expect(n[0].body).toBe('Bia registrou R$ 347,00 adiantados da sua parte em "Sofá" (Família): parcelas 1 a 3 pagas e R$ 47,00 da parcela 4.');
	});

	it("o administrador registra: avisa quem recebe e o devedor, cada um uma vez", () => {
		const n = buildAdvanceNotices(fact({ actorUid: "adm", manual: true }), ctx);
		expect(n.map((x) => [x.uid, x.title]).sort()).toEqual([["ana", "Adiantamento registrado"], ["bia", "Adiantamento registrado"]]);
		expect(n.find((x) => x.uid === "bia")!.body).toContain("da parte de Ana");
	});

	it("pessoa cuidada: o responsável paga e o aviso diz de quem é a parte; quem cuida não é avisado de si mesmo", () => {
		const n = buildAdvanceNotices(fact({ debtorUid: "m_vo", actorUid: "ana" }), ctx);
		expect(n.map((x) => x.uid)).toEqual(["bia"]);
		expect(n[0].body).toContain("Ana adiantou R$ 347,00 da parte de Vó Lia");
		// quem recebe é a pessoa cuidada: o aviso vai para quem cuida dela
		const toCarer = buildAdvanceNotices(fact({ paidBy: "m_vo", debtorUid: "bia", actorUid: "bia" }), ctx);
		expect(toCarer.map((x) => x.uid)).toEqual(["ana"]);
		expect(toCarer[0].body).toContain("Para Vó Lia.");
	});

	it("grupo desconhecido ou sem parcelas: nada", () => {
		expect(buildAdvanceNotices(fact({ groupId: "outro" }), ctx)).toEqual([]);
		expect(buildAdvanceNotices(fact({ items: [] }), ctx)).toEqual([]);
	});
});
