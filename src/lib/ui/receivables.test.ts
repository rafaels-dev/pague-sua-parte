import { describe, expect, it } from "vitest";
import { buildCollectText, collectLink, debtorCaption, firstName, normalizeReceivables, payeeNote, type Debtor, type ReceivableItem } from "./receivables";

const item = (description: string, dueCents = 1000, o: Partial<ReceivableItem> = {}): ReceivableItem => ({
	kind: "share",
	groupId: "g1",
	groupName: "Casa",
	expenseId: description,
	description,
	dueCents,
	dueDate: null,
	overdue: false,
	installment: null,
	recurrence: false,
	payeeIsYou: true,
	payeeName: "Eu",
	...o,
});
const debtor = (items: ReceivableItem[], o: Partial<Debtor> = {}): Debtor => ({
	uid: "u",
	name: "Maria das Dores Silva",
	picture: null,
	kind: "user",
	managedByName: null,
	youManage: false,
	totalCents: items.reduce((s, i) => s + i.dueCents, 0),
	overdueCents: 0,
	items,
	...o,
});

describe("normalizeReceivables", () => {
	it("resposta estranha vira lista vazia com zeros", () => {
		for (const raw of [null, undefined, 3, "x", {}, { debtors: "x" }]) {
			expect(normalizeReceivables(raw)).toEqual({ debtors: [], totalCents: 0, nowCents: 0, managedCents: 0, truncated: false });
		}
	});
	it("completa o que falta, descarta devedor sem itens válidos e itens quebrados", () => {
		const r = normalizeReceivables({
			debtors: [
				{ uid: "a", name: "Ana", items: [{ groupId: "g", expenseId: "e", description: "X", dueCents: 500, dueDate: "2026-11-20T00:00:00Z", installment: { number: 2, count: 6 }, recurrence: true, payeeName: "Eu" }, { nope: 1 }] },
				{ uid: "b", items: [] },
				{ uid: "m", name: "Ben", kind: "managed", managedByName: "Renata", items: [{ groupId: "g", expenseId: "f", dueCents: 300, overdue: true, payeeIsYou: false, payeeName: "Ben" }] },
			],
		});
		expect(r.debtors.map((d) => [d.uid, d.totalCents, d.overdueCents, d.kind, d.managedByName])).toEqual([["a", 500, 0, "user", null], ["m", 300, 300, "managed", "Renata"]]);
		expect(r.debtors[0].items[0]).toMatchObject({ dueDate: "2026-11-20", installment: { number: 2, count: 6 }, recurrence: true, payeeIsYou: true });
		expect(r.debtors[1].items[0].payeeIsYou).toBe(false);
		expect([r.totalCents, r.nowCents, r.managedCents, r.truncated]).toEqual([800, 800, 0, false]);
	});
	it("mantém os totais do servidor", () => {
		const r = normalizeReceivables({ debtors: [], totalCents: 900, nowCents: 400, managedCents: 100, truncated: true });
		expect([r.totalCents, r.nowCents, r.managedCents, r.truncated]).toEqual([900, 400, 100, true]);
	});
});

describe("legendas", () => {
	it("debtorCaption", () => {
		expect(debtorCaption({ kind: "user", youManage: false, managedByName: null })).toBeNull();
		expect(debtorCaption({ kind: "managed", youManage: false, managedByName: "Renata" })).toBe("Sem celular · quem cuida: Renata");
		expect(debtorCaption({ kind: "managed", youManage: true, managedByName: "Rafael" })).toBe("Sem celular · você cuida");
		expect(debtorCaption({ kind: "managed", youManage: false, managedByName: null })).toBe("Sem celular");
	});
	it("payeeNote", () => {
		expect(payeeNote({ payeeIsYou: true, payeeName: "Eu" })).toBeNull();
		expect(payeeNote({ payeeIsYou: false, payeeName: "Benjamim" })).toBe("para Benjamim");
	});
	it("firstName", () => {
		expect(firstName("  Maria das Dores ")).toBe("Maria");
		expect(firstName("")).toBe("");
	});
});

describe("buildCollectText", () => {
	it("primeiro nome, total e descrições", () => {
		const d = debtor([item("Remédios da farmácia", 7248), item("Mercado do mês", 10000), item("Aluguel", 0)]);
		expect(buildCollectText(d, "https://x/app/grupos/g1")).toBe(
			"Oi, Maria! Faltam R$ 172,48 das nossas despesas: Remédios da farmácia, Mercado do mês e Aluguel. Dá para pagar pelo app: https://x/app/grupos/g1",
		);
	});
	it("mais de 4 descrições: 3 e '+ N outras'", () => {
		const d = debtor(["A", "B", "C", "D", "E"].map((x) => item(x)));
		expect(buildCollectText(d, "L")).toContain("das nossas despesas: A, B, C + 2 outras. Dá");
	});
	it("pessoa sem celular: fala com quem cuida", () => {
		const d = debtor([item("Fraldas", 3333)], { name: "Benjamim Souza", kind: "managed", managedByName: "Renata Lima" });
		expect(buildCollectText(d, "L")).toBe("Oi, Renata! Faltam R$ 33,33 da parte de Benjamim das nossas despesas: Fraldas. Dá para pagar pelo app: L");
		expect(buildCollectText({ ...d, managedByName: null }, "L")).toMatch(/^Oi! Faltam R\$ 33,33 da parte de Benjamim /);
	});
	it("link: grupo quando tudo é de um grupo, senão o início do app", () => {
		expect(collectLink("https://x/", [{ groupId: "g1" }, { groupId: "g1" }])).toBe("https://x/app/grupos/g1");
		expect(collectLink("https://x", [{ groupId: "g1" }, { groupId: "g2" }])).toBe("https://x/app");
	});
});
