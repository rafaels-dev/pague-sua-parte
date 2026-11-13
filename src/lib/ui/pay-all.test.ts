import { describe, expect, it } from "vitest";
import {
	batchCaption,
	batchExpectedTotal,
	buildPayAllShareText,
	describeItems,
	failReasonText,
	itemKey,
	normalizeBatch,
	normalizeBatchResult,
	normalizePayables,
	payAllLink,
	payAllPayload,
	pixIsCurrent,
	removePaid,
	selectedItems,
	selectedTotal,
	selectionLabel,
	shareFieldsFor,
	toggleUnchecked,
	type PayableItem,
} from "./pay-all";

const item = (o: Partial<PayableItem> = {}): PayableItem => ({
	kind: "share",
	groupId: "g1",
	groupName: "Despesas da vó",
	expenseId: "e1",
	description: "Remédios",
	shareUid: "a",
	shareName: "Rafael",
	isYou: true,
	dueCents: 10000,
	dueDate: null,
	overdue: false,
	installment: null,
	recurrence: false,
	...o,
});

describe("seleção", () => {
	const items = [item({ expenseId: "e1", dueCents: 10000 }), item({ expenseId: "e2", dueCents: 2550 }), item({ expenseId: "e3", dueCents: 700 })];
	it("tudo marcado por padrão", () => {
		expect(selectedItems(items, [])).toHaveLength(3);
		expect(selectedTotal(items, [])).toBe(13250);
	});
	it("desmarcar tira do total", () => {
		const un = toggleUnchecked([], itemKey(items[1]));
		expect(selectedTotal(items, un)).toBe(10700);
		expect(toggleUnchecked(un, itemKey(items[1]))).toEqual([]);
	});
	it("nada marcado soma zero", () => {
		expect(selectedTotal(items, items.map(itemKey))).toBe(0);
	});
	it("a chave distingue a parte de cada pessoa na mesma despesa", () => {
		expect(itemKey(item({ shareUid: "a" }))).not.toBe(itemKey(item({ shareUid: "m1" })));
	});
	it("texto da seleção", () => {
		expect(selectionLabel(0, 3)).toBe("Nenhuma conta marcada");
		expect(selectionLabel(2, 3)).toBe("2 de 3 contas marcadas");
		expect(selectionLabel(3, 3)).toBe("Todas as 3 contas");
		expect(selectionLabel(1, 1)).toBe("1 conta");
	});
});

describe("Pix", () => {
	const r = { pix: { type: "cpf" as const, key: "52998224725", payeeName: "Maria das Dores" } };
	it("gera o código com o valor", () => {
		const code = payAllPayload(r, 35000);
		expect(code).toMatch(/^000201/);
		expect(code).toContain("350.00");
	});
	it("valor zero ou chave vazia: null", () => {
		expect(payAllPayload(r, 0)).toBeNull();
		expect(payAllPayload({ pix: { ...r.pix, key: "" } }, 100)).toBeNull();
	});
	it("o código só vale para o valor em que foi gerado", () => {
		expect(pixIsCurrent(null, 100)).toBe(false);
		expect(pixIsCurrent(100, 100)).toBe(true);
		expect(pixIsCurrent(100, 90)).toBe(false);
		expect(pixIsCurrent(0, 0)).toBe(false);
	});
});

describe("mensagem", () => {
	const base = { totalCents: 35000, expenseCount: 3, forNames: [] as string[], allManaged: false, hasReceipt: true };
	it("com comprovante", () => {
		expect(buildPayAllShareText({ ...base, descriptions: ["Remédios da farmácia", "Mercado do mês", "Aluguel"] }, "https://x/app/grupos/g1")).toBe(
			"Paguei R$ 350,00 de uma vez, referentes a 3 despesas: Remédios da farmácia, Mercado do mês e Aluguel. Veja o comprovante: https://x/app/grupos/g1",
		);
	});
	it("sem comprovante", () => {
		expect(buildPayAllShareText({ ...base, hasReceipt: false, descriptions: ["A", "B", "C"] }, "L")).toContain("Confira aqui: L");
	});
	it("pessoa sem celular: as partes dela", () => {
		const t = buildPayAllShareText({ ...base, totalCents: 12000, forNames: ["Benjamim"], allManaged: true, descriptions: ["A", "B", "C"] }, "L");
		expect(t).toContain("Paguei R$ 120,00 de uma vez, as partes de Benjamim, referentes a 3 despesas");
	});
	it("suas partes e as de outra pessoa", () => {
		const t = buildPayAllShareText({ ...base, forNames: ["Benjamim", "Benjamim", "Tio Carlos"], allManaged: false, descriptions: ["A", "B", "C"] }, "L");
		expect(t).toContain("as minhas partes e as de Benjamim e Tio Carlos");
	});
	it("uma despesa só", () => {
		expect(buildPayAllShareText({ ...base, expenseCount: 1, descriptions: ["Aluguel."] }, "L")).toContain("referente a 1 despesa: Aluguel.");
	});
	it("mais de 4: lista 3 e diz quantas outras", () => {
		expect(describeItems(["A", "B", "C", "D"])).toBe("A, B, C e D");
		expect(describeItems(["A", "B", "C", "D", "E"])).toBe("A, B, C + 2 outras");
		expect(describeItems(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C + 3 outras");
	});
	it("descrições repetidas aparecem uma vez", () => {
		expect(describeItems(["Aluguel", "Aluguel ", "Luz"])).toBe("Aluguel e Luz");
	});
	it("campos a partir dos itens", () => {
		const f = shareFieldsFor([item({ expenseId: "e1" }), item({ expenseId: "e1", shareUid: "m1", shareName: "Benjamim", isYou: false }), item({ expenseId: "e2", groupId: "g2" })]);
		expect(f.expenseCount).toBe(2);
		expect(f.forNames).toEqual(["Benjamim"]);
		expect(f.allManaged).toBe(false);
		expect(shareFieldsFor([item({ isYou: false, shareName: "B" })]).allManaged).toBe(true);
	});
});

describe("link", () => {
	it("um grupo só: página do grupo", () => {
		expect(payAllLink("https://x/", [{ groupId: "g 1" }, { groupId: "g 1" }])).toBe("https://x/app/grupos/g%201");
	});
	it("grupos diferentes: início do app", () => {
		expect(payAllLink("https://x", [{ groupId: "g1" }, { groupId: "g2" }])).toBe("https://x/app");
	});
});

describe("motivos", () => {
	it("palavras simples", () => {
		expect(failReasonText("already_paid")).toBe("já estava paga");
		expect(failReasonText("conflict")).toBe("mudou agora há pouco");
		expect(failReasonText("not_found")).toBe("não existe mais");
	});
});

describe("normalizePayables", () => {
	it("resposta ruim vira lista vazia", () => {
		expect(normalizePayables(null)).toEqual([]);
		expect(normalizePayables({})).toEqual([]);
		expect(normalizePayables({ recipients: "x" })).toEqual([]);
	});
	it("completa o que falta e descarta o que não dá para mostrar", () => {
		const out = normalizePayables({
			recipients: [
				{ id: "r1", payee: { uid: "b", name: "Maria", kind: "user" }, pix: { type: "cpf", key: "123", payeeName: "Maria S" }, totalCents: 500, items: [{ groupId: "g", expenseId: "e", shareUid: "a", dueCents: 500, installment: { number: 2, count: 6 }, dueDate: "2026-11-20T00:00:00Z" }, { nada: 1 }] },
				{ id: "vazio", payee: {}, pix: {}, items: [] },
				null,
			],
		});
		expect(out).toHaveLength(1);
		expect(out[0].items).toHaveLength(1);
		expect(out[0].items[0]).toMatchObject({ description: "", isYou: false, overdue: false, recurrence: false, dueDate: "2026-11-20", installment: { number: 2, count: 6 } });
	});
	it("tipo de chave desconhecido e total ausente", () => {
		const [r] = normalizePayables({ recipients: [{ payee: { uid: "b", name: "M" }, pix: { type: "??", key: "k" }, items: [{ groupId: "g", expenseId: "e", shareUid: "a", dueCents: 300 }, { groupId: "g", expenseId: "f", shareUid: "a", dueCents: 200 }] }] });
		expect(r.pix.type).toBe("random");
		expect(r.pix.payeeName).toBe("M");
		expect(r.totalCents).toBe(500);
		expect(r.id).toBe("b");
	});
	it("parcela inválida vira null", () => {
		const [r] = normalizePayables({ recipients: [{ id: "x", payee: { uid: "b" }, pix: {}, items: [{ groupId: "g", expenseId: "e", shareUid: "a", installment: { number: 0, count: 3 } }] }] });
		expect(r.items[0].installment).toBeNull();
	});
});

describe("normalizeBatchResult", () => {
	it("vazio tem valores seguros", () => {
		expect(normalizeBatchResult(null)).toEqual({ batchId: "", paid: [], failed: [], totalPaidCents: 0, hasReceipt: false });
	});
	it("motivo desconhecido vira conflito; total ausente é somado", () => {
		const r = normalizeBatchResult({ paid: [{ groupId: "g", expenseId: "e", shareUid: "a", amountCents: 100 }, { groupId: "g", expenseId: "f", shareUid: "a", amountCents: 250 }], failed: [{ groupId: "g", expenseId: "h", shareUid: "a", reason: "xyz" }], hasReceipt: true });
		expect(r.totalPaidCents).toBe(350);
		expect(r.failed[0].reason).toBe("conflict");
		expect(r.hasReceipt).toBe(true);
	});
});

describe("removePaid", () => {
	it("tira as pagas, refaz o total e some com quem ficou sem nada", () => {
		const a = item({ expenseId: "e1", dueCents: 100 });
		const b = item({ expenseId: "e2", dueCents: 200 });
		const rs = [
			{ id: "r1", payee: { uid: "b", name: "M", picture: null, kind: "user" as const }, pix: { type: "cpf" as const, key: "k", payeeName: "M" }, totalCents: 300, items: [a, b] },
			{ id: "r2", payee: { uid: "c", name: "J", picture: null, kind: "user" as const }, pix: { type: "cpf" as const, key: "k", payeeName: "J" }, totalCents: 100, items: [item({ expenseId: "e3", dueCents: 100 })] },
		];
		const out = removePaid(rs, new Set([itemKey(a), itemKey(rs[1].items[0])]));
		expect(out).toHaveLength(1);
		expect(out[0].items).toEqual([b]);
		expect(out[0].totalCents).toBe(200);
	});
});

describe("batchCaption", () => {
	it("outras contas", () => {
		expect(batchCaption({ count: 3, totalCents: 35000 })).toBe("Pago junto com outras 2 contas (R$ 350,00 no total)");
		expect(batchCaption({ count: 2, totalCents: 8000 })).toBe("Pago junto com outra conta (R$ 80,00 no total)");
	});
	it("sozinha: nada", () => {
		expect(batchCaption(null)).toBeNull();
		expect(batchCaption({ count: 1, totalCents: 100 })).toBeNull();
	});
	it("normalizer", () => {
		expect(normalizeBatch({ totalCents: 100, count: 2 })).toEqual({ totalCents: 100, count: 2 });
		expect(normalizeBatch(undefined)).toBeNull();
		expect(normalizeBatch({ totalCents: "1", count: 2 })).toBeNull();
		expect(normalizeBatch({ totalCents: 1, count: 0 })).toBeNull();
	});
});

describe("batchExpectedTotal: o total enviado é sempre o que a tela mostra", () => {
	const items = [item({ expenseId: "e1", dueCents: 7000 }), item({ expenseId: "e2", dueCents: 3000 })];
	it("com tudo marcado é o total; ao desmarcar um item o total enviado acompanha a seleção, mesmo que um Pix de R$ 100 já tenha sido gerado", () => {
		expect(batchExpectedTotal(items, [])).toBe(10000);
		const pixGerado = 10000;
		const unchecked = toggleUnchecked([], itemKey(items[1]));
		expect(batchExpectedTotal(items, unchecked)).toBe(7000);
		expect(batchExpectedTotal(items, unchecked)).toBe(selectedTotal(items, unchecked)); // o valor grande do cartão
		expect(pixIsCurrent(pixGerado, selectedTotal(items, unchecked))).toBe(false); // o Pix antigo deixa de valer na tela
	});
	it("nada marcado: zero", () => {
		expect(batchExpectedTotal(items, items.map(itemKey))).toBe(0);
	});
});
