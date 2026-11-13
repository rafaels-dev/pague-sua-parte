import { describe, expect, it } from "vitest";
import { advancePayload, ADVANCE_LINK, advanceDoneMessage, advanceShortcuts, checkAdvance, type AdvancePlanData } from "./advance";

const plan = (dues: number[], first = 1, current = first): AdvancePlanData => ({
	shareUid: "u",
	currentNumber: current,
	thisDueCents: dues[current - first] ?? 0,
	totalDueCents: dues.reduce((t, d) => t + d, 0),
	items: dues.map((d, k) => ({ id: `e${k}`, number: first + k, dueDate: null, dueCents: d })),
	recipient: { id: "r_0123456789abcdef01234567", name: "Maria", pix: null },
	moreRecipients: false,
});

describe("atalhos (na ordem em que o dinheiro vai)", () => {
	it("próxima parcela, as 2 próximas e tudo que falta", () => {
		expect(advanceShortcuts(plan([10000, 10000, 10000, 10000]))).toEqual([
			{ key: "first", label: "Próxima parcela (nº 1)", cents: 10000 },
			{ key: "two", label: "As 2 próximas", cents: 20000 },
			{ key: "all", label: "Tudo que falta", cents: 40000 },
		]);
	});
	it("a próxima é a mais antiga em aberto, não a da tela", () => {
		const s = advanceShortcuts(plan([10000, 10000, 10000], 2, 4));
		expect(s[0]).toMatchObject({ label: "Próxima parcela (nº 2)", cents: 10000 });
	});
	it("com duas parcelas em aberto, 'as 2 próximas' já é 'tudo que falta' (sem repetir)", () => {
		expect(advanceShortcuts(plan([10000, 8000])).map((s) => s.key)).toEqual(["first", "all"]);
	});
	it("com parcelas para outro destinatário de fora, 'tudo' diz para quem vai", () => {
		const p = { ...plan([10000, 10000, 10000]), moreRecipients: true };
		expect(advanceShortcuts(p).at(-1)).toEqual({ key: "all", label: "Tudo para Maria", cents: 30000 });
	});
	it("só uma parcela em aberto; nenhuma", () => {
		expect(advanceShortcuts(plan([10000], 3))).toEqual([{ key: "first", label: "Parcela 3", cents: 10000 }]);
		expect(advanceShortcuts(plan([]))).toEqual([]);
	});
});

describe("checkAdvance", () => {
	const p = plan(Array(10).fill(10000));
	it("prévia do exemplo do dono, calculada pela mesma função do servidor, sem aviso de parcela anterior", () => {
		expect(checkAdvance(p, 34700)).toMatchObject({ kind: "ok", note: null, preview: "Paga as parcelas 1, 2 e 3 e R$ 47,00 da parcela 4. Na parcela 4 ficam faltando R$ 53,00." });
	});
	it("parcela 4 na tela e a 2 em aberto: a prévia nomeia as parcelas e diz que vai primeiro para a 2", () => {
		const older = plan([10000, 10000, 10000, 10000], 2, 4);
		expect(checkAdvance(older, 15000)).toMatchObject({
			kind: "ok",
			preview: "Paga a parcela 2 e R$ 50,00 da parcela 3. Na parcela 3 ficam faltando R$ 50,00.",
			note: "A parcela 2 está em aberto: o dinheiro vai primeiro para ela.",
		});
	});
	it("vazio, zero e maior que o total", () => {
		expect(checkAdvance(p, 0)).toEqual({ kind: "empty" });
		expect(checkAdvance(p, 100001)).toMatchObject({ kind: "too_much", message: "Esse valor é maior do que falta pagar (R$ 1.000,00)." });
		expect(checkAdvance(p, 100000).kind).toBe("ok");
	});
});

describe("textos", () => {
	const done = { totalCents: 34700, hasReceipt: false, batchId: "b", items: [
		{ number: 1, cents: 10000, settled: true, remainingCents: 0 },
		{ number: 2, cents: 10000, settled: true, remainingCents: 0 },
		{ number: 3, cents: 10000, settled: true, remainingCents: 0 },
		{ number: 4, cents: 4700, settled: false, remainingCents: 5300 },
	] };
	it("mensagem curta de quem pagou e de quem recebeu", () => {
		expect(advanceDoneMessage(done, { mode: "self", name: "Ana" })).toBe("Pronto! Parcelas 1 a 3 pagas e R$ 47,00 da parcela 4.");
		expect(advanceDoneMessage(done, { mode: "manual", name: "Ana" })).toBe("Recebido R$ 347,00 de Ana: parcelas 1 a 3 pagas e R$ 47,00 da parcela 4.");
	});
	it("o link só muda na parcelada e é curto", () => {
		expect(ADVANCE_LINK.length).toBeLessThan(45);
	});
});

describe("advancePayload (Pix da folha)", () => {
	const withPix = (key: string): AdvancePlanData => ({ ...plan([10000, 10000], 1, 3), recipient: { id: "r_0123456789abcdef01234567", name: "Maria", pix: { type: "email", key, payeeName: "Maria Silva" } } });
	it("usa a chave e o recebedor das parcelas do plano (não os da parcela da tela) e não diz 'parcela N de M'", () => {
		const code = advancePayload(withPix("maria@x.com"), "Sofá da sala", 34700)!;
		expect(code).toContain("maria@x.com");
		expect(code).toContain("MARIA SILVA");
		expect(code).not.toMatch(/parcela/i);
		expect(advancePayload(withPix("joao@x.com"), "Sofá da sala", 34700)).toContain("joao@x.com");
	});
	it("sem chave ou sem valor: não gera", () => {
		expect(advancePayload(plan([10000]), "Sofá", 100)).toBeNull();
		expect(advancePayload(withPix("maria@x.com"), "Sofá", 0)).toBeNull();
	});
});
