import { describe, expect, it } from "vitest";
import { buildMemberJoinedNotices, buildNewExpenseNotices, buildPaymentNotices, loginOf } from "./messages";
import type { NewExpenseFact, NoticeContext, PaymentFact } from "./types";

const G = "507f1f77bcf86cd799439011";
const E = "507f1f77bcf86cd799439012";
const members = [
	{ uid: "adm", role: "admin" as const, name: "Admin" },
	{ uid: "ana", role: "member" as const },
	{ uid: "bia", role: "member" as const },
	{ uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "ana", name: "Vó Lia" },
	{ uid: "m_tio", role: "member" as const, kind: "managed" as const, managedBy: "ana", name: "Tio Zé" },
];
const NAMES: Record<string, string> = { adm: "Admin", ana: "Ana", bia: "Bia", m_vo: "Vó Lia", m_tio: "Tio Zé" };
const ctx: NoticeContext = { group: (id) => (id === G ? { name: "Família", members } : undefined), name: (_g, uid) => NAMES[uid] ?? "Alguém" };

const pay = (over: Partial<PaymentFact> = {}): PaymentFact => ({
	groupId: G, expenseId: E, description: "Mercado", paidBy: "bia", debtorUid: "ana", amountCents: 5000, kind: "payment", actorUid: "ana", manual: false, ...over,
});

describe("loginOf", () => {
	it("pessoa cuidada vira quem cuida; quem saiu do grupo, ninguém", () => {
		expect(loginOf(members, "m_vo")).toBe("ana");
		expect(loginOf(members, "bia")).toBe("bia");
		expect(loginOf(members, "fora")).toBeNull();
	});
});

describe("entrou no grupo", () => {
	it("avisa só o administrador, nunca quem entrou", () => {
		const n = buildMemberJoinedNotices({ groupId: G, groupName: "Família", members, joinerUid: "bia", joinerName: "Bia" });
		expect(n).toEqual([{ uid: "adm", title: "Alguém entrou no grupo", body: "Bia entrou no grupo Família.", url: `/app/grupos/${G}` }]);
		expect(buildMemberJoinedNotices({ groupId: G, groupName: "F", members, joinerUid: "adm", joinerName: "Admin" })).toEqual([]);
	});
});

describe("pagamentos", () => {
	it("Já paguei: avisa quem recebeu, com link da despesa", () => {
		const [n, ...rest] = buildPaymentNotices([pay()], ctx);
		expect(rest).toEqual([]);
		expect(n).toMatchObject({ uid: "bia", title: "Pagamento recebido", body: 'Ana pagou R$ 50,00 em "Mercado" (Família).', url: `/app/grupos/${G}/despesas/${E}` });
	});
	it("quem recebe é pessoa cuidada: avisa quem cuida e diz para quem", () => {
		const [n] = buildPaymentNotices([pay({ paidBy: "m_vo", actorUid: "bia", debtorUid: "bia" })], ctx);
		expect(n.uid).toBe("ana");
		expect(n.body).toContain("Para Vó Lia.");
	});
	it("nunca avisa quem fez a ação", () => {
		expect(buildPaymentNotices([pay({ paidBy: "ana" })], ctx)).toEqual([]);
		expect(buildPaymentNotices([pay({ kind: "refund", debtorUid: "ana", actorUid: "ana" })], ctx)).toEqual([]);
	});
	it("marcada pelo administrador: avisa quem recebe e o devedor", () => {
		const r = buildPaymentNotices([pay({ manual: true, actorUid: "adm" })], ctx);
		expect(r.map((n) => n.uid).sort()).toEqual(["ana", "bia"]);
		expect(r.find((n) => n.uid === "ana")?.body).toBe('Admin marcou sua parte de "Mercado" (Família) como paga.');
		expect(r.find((n) => n.uid === "bia")?.body).toContain("Admin marcou como paga a parte de Ana");
	});
	it("o dono marca a parte de quem ele cuida: ninguém é avisado de duplicado", () => {
		// Ana cuida de Vó Lia e marca a parte dela numa despesa de Bia: Bia (dono) é o autor? não, Ana é.
		const r = buildPaymentNotices([pay({ manual: true, actorUid: "ana", debtorUid: "m_vo" })], ctx);
		expect(r.map((n) => n.uid)).toEqual(["bia"]);
	});
	it("dono marca parte de um membro: só o devedor é avisado (o dono é o autor)", () => {
		const r = buildPaymentNotices([pay({ manual: true, actorUid: "bia" })], ctx);
		expect(r.map((n) => n.uid)).toEqual(["ana"]);
	});
	it("o próprio devedor marcando a sua parte (admin) vale como \"pagou\"", () => {
		const r = buildPaymentNotices([pay({ manual: true, actorUid: "ana", debtorUid: "ana", paidBy: "bia" })], ctx);
		expect(r).toEqual([{ uid: "bia", title: "Pagamento recebido", body: 'Ana pagou R$ 50,00 em "Mercado" (Família).', url: `/app/grupos/${G}/despesas/${E}` }]);
	});
	it("lote ao devedor: \"suas\" só quando são dele; quem só cuida lê \"de quem você cuida\"", () => {
		const f = (debtorUid: string, id: string) => pay({ manual: true, actorUid: "adm", debtorUid, expenseId: id });
		const own = buildPaymentNotices([f("ana", "1"), f("ana", "2")], ctx).find((n) => n.uid === "ana");
		expect(own?.body).toBe("Admin marcou 2 partes suas como pagas.");
		const carer = buildPaymentNotices([f("m_vo", "1"), f("m_tio", "2")], ctx).find((n) => n.uid === "ana");
		expect(carer?.body).toBe("Admin marcou 2 partes de quem você cuida como pagas.");
		const mixed = buildPaymentNotices([f("ana", "1"), f("m_vo", "2")], ctx).find((n) => n.uid === "ana");
		expect(mixed?.body).toBe("Admin marcou 2 partes como pagas (suas e de quem você cuida).");
	});
	it("lote: um aviso por destinatário com o total", () => {
		const r = buildPaymentNotices(
			[pay({ amountCents: 5000 }), pay({ expenseId: "e2", amountCents: 4000 }), pay({ expenseId: "e3", amountCents: 3000, debtorUid: "m_vo" })],
			ctx,
		);
		expect(r).toEqual([{ uid: "bia", title: "Pagamento recebido", body: "Ana pagou R$ 120,00 de 3 contas.", url: "/app/receber" }]);
	});
	it("devolução: avisa quem recebe (ou quem cuida)", () => {
		expect(buildPaymentNotices([pay({ kind: "refund", paidBy: "ana", debtorUid: "bia", actorUid: "ana" })], ctx)[0]).toMatchObject({
			uid: "bia",
			title: "Devolução recebida",
			body: 'Ana devolveu R$ 50,00 de "Mercado" (Família).',
		});
		const c = buildPaymentNotices([pay({ kind: "refund", paidBy: "bia", debtorUid: "m_vo", actorUid: "bia" })], ctx)[0];
		expect(c.uid).toBe("ana");
		expect(c.body).toContain("para Vó Lia");
	});
	it("nunca inclui chave Pix e ignora grupo desconhecido", () => {
		expect(buildPaymentNotices([pay({ groupId: "outro" })], ctx)).toEqual([]);
	});
});

const exp = (over: Partial<NewExpenseFact> = {}): NewExpenseFact => ({
	groupId: G, expenseId: E, description: "Luz", amountCents: 30000, paidBy: "bia", actorUid: "bia",
	shares: [{ uid: "bia", amountCents: 7500 }, { uid: "ana", amountCents: 7500 }, { uid: "adm", amountCents: 7500 }, { uid: "m_vo", amountCents: 7500 }], ...over,
});

describe("despesa nova", () => {
	it("avisa quem divide, soma as partes de quem cuida e não avisa quem lançou", () => {
		const r = buildNewExpenseNotices(exp(), "created", ctx);
		expect(r.map((n) => n.uid).sort()).toEqual(["adm", "ana"]);
		expect(r.find((n) => n.uid === "adm")?.body).toBe('Bia lançou "Luz" no grupo Família. Sua parte: R$ 75,00');
		expect(r.find((n) => n.uid === "ana")?.body).toContain("Sua parte e de quem você cuida: R$ 150,00");
	});
	it("quem cuida de várias pessoas recebe um aviso só", () => {
		const r = buildNewExpenseNotices(exp({ shares: [{ uid: "ana", amountCents: 1000 }, { uid: "m_vo", amountCents: 1000 }, { uid: "m_tio", amountCents: 1000 }] }), "created", ctx);
		expect(r).toHaveLength(1);
		expect(r[0].body).toContain("R$ 30,00");
	});
	it("administrador lança em nome de outro: o pagador também é avisado", () => {
		const r = buildNewExpenseNotices(exp({ actorUid: "adm", paidBy: "bia", shares: [{ uid: "ana", amountCents: 15000 }, { uid: "bia", amountCents: 15000 }] }), "created", ctx);
		expect(r.map((n) => n.uid).sort()).toEqual(["ana", "bia"]);
		expect(r.find((n) => n.uid === "bia")).toMatchObject({ title: "Despesa lançada em seu nome", body: 'Admin lançou uma despesa em seu nome: "Luz", R$ 300,00.' });
	});
	it("admin lança em nome de pessoa cuidada: o responsável lê de quem é", () => {
		const r = buildNewExpenseNotices(exp({ actorUid: "adm", paidBy: "m_vo", shares: [{ uid: "bia", amountCents: 5000 }, { uid: "m_vo", amountCents: 5000 }] }), "created", ctx);
		const n = r.find((x) => x.uid === "ana");
		expect(n?.title).toBe("Despesa lançada em nome de quem você cuida");
		expect(n?.body).toBe('Admin lançou uma despesa em nome de Vó Lia: "Luz", R$ 300,00.');
	});
	it("quem cria a despesa fixa não recebe o aviso da primeira geração", () => {
		const r = buildNewExpenseNotices(exp({ actorUid: "adm", paidBy: "bia" }), "recurring", ctx);
		expect(r.map((n) => n.uid)).toEqual(["ana"]);
	});
	it("parcelada informa as parcelas", () => {
		const r = buildNewExpenseNotices(exp({ installments: 3 }), "created", ctx);
		expect(r.find((n) => n.uid === "adm")?.body).toBe('Bia lançou "Luz" em 3 parcelas no grupo Família. Sua parte em cada parcela: R$ 75,00');
	});
	it("despesa fixa: não há autor, só quem pagou fica de fora", () => {
		const r = buildNewExpenseNotices(exp({ actorUid: null }), "recurring", ctx);
		expect(r.map((n) => n.uid).sort()).toEqual(["adm", "ana"]);
		expect(r[0].title).toBe("Despesa fixa do mês");
		expect(r[0].body).toContain('Nova despesa fixa: "Luz" no grupo Família.');
	});
	it("despesa fixa paga por pessoa cuidada: quem cuida não é avisado do que paga", () => {
		const r = buildNewExpenseNotices(exp({ actorUid: null, paidBy: "m_vo", shares: [{ uid: "m_vo", amountCents: 1000 }, { uid: "bia", amountCents: 1000 }] }), "recurring", ctx);
		expect(r.map((n) => n.uid)).toEqual(["bia"]);
	});
	it("edição: quem entrou recebe o aviso de inclusão", () => {
		const r = buildNewExpenseNotices(exp({ actorUid: "bia", shares: [{ uid: "adm", amountCents: 5000 }] }), "added", ctx);
		expect(r).toEqual([{ uid: "adm", title: "Você entrou numa despesa", body: 'Bia incluiu você em "Luz" no grupo Família. Sua parte: R$ 50,00', url: `/app/grupos/${G}/despesas/${E}` }]);
	});
});
