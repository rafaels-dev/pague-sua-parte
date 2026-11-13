import { describe, expect, it } from "vitest";
import {
	addPayment,
	balanceOf,
	canUndoOwnPart,
	checkShareInvariant,
	hasTopPayment,
	latestPayment,
	normalizeShares,
	partsPaidCents,
	receiptKeysOfShare,
	topCentsOf,
	undoShareIfCurrent,
	droppedReceiptKeys,
	dueCents,
	hasPayments,
	MAX_PARTS,
	payShare,
	payShares,
	recalcShares,
	settleShare,
	shareStatus,
	undoShare,
	type ExpenseShare,
	type ShareReceipt,
} from "./shares";

const OWNER = "o";
const NOW = new Date("2026-11-11T12:00:00Z");
const D1 = new Date("2026-11-01T12:00:00Z");
const D2 = new Date("2026-11-05T12:00:00Z");
const rc = (id: string): ShareReceipt => ({ id, key: `receipts/${id}`, name: `${id}.png`, contentType: "image/png", size: 4 });
const sh = (uid: string, amountCents: number, paidCents = 0, extra: Partial<ExpenseShare> = {}): ExpenseShare => ({ uid, amountCents, paidCents, ...extra });
const pay = (shares: ExpenseShare[], cents: number, o: Partial<{ method: "self" | "manual"; asAdmin: boolean; receipt: ShareReceipt; partId: string; actor: string; now: Date }> = {}) =>
	addPayment(shares, OWNER, "a", cents, o.now ?? NOW, o.actor ?? "a", { method: o.method ?? "self", asAdmin: o.asAdmin, receipt: o.receipt, partId: o.partId ?? "p1" });
const changed = (r: ReturnType<typeof pay>) => {
	if (!r || "error" in r) throw new Error("esperava mudança, veio " + JSON.stringify(r));
	return r.shares;
};
const a = (shares: ExpenseShare[]) => shares.find((s) => s.uid === "a")!;

describe("addPayment: valor menor que o que falta (parcial)", () => {
	it("acrescenta em parts, soma em paidCents e deixa a parte em aberto sem campos de topo", () => {
		const next = changed(pay([sh("a", 10000)], 4700, { receipt: rc("r1") }));
		expect(a(next)).toEqual({
			uid: "a",
			amountCents: 10000,
			paidCents: 4700,
			parts: [{ id: "p1", cents: 4700, at: NOW, markedBy: "a", method: "self", receipt: rc("r1") }],
		});
		expect(shareStatus(a(next), OWNER)).toBe("pending");
		expect(dueCents(a(next), OWNER)).toBe(5300);
		for (const k of ["paidAt", "markedBy", "method", "receipt", "batch", "markedByAdmin"] as const) expect(a(next)).not.toHaveProperty(k);
	});
	it("vários parciais ficam em ordem; sem comprovante a parte não ganha a chave receipt", () => {
		let s = changed(pay([sh("a", 10000)], 1000, { partId: "p1", now: D1 }));
		s = changed(pay(s, 2000, { partId: "p2", now: D2 }));
		expect(a(s).paidCents).toBe(3000);
		expect(a(s).parts!.map((p) => [p.id, p.cents, p.at])).toEqual([["p1", 1000, D1], ["p2", 2000, D2]]);
		expect(a(s).parts![0]).not.toHaveProperty("receipt");
	});
	it("recebido por quem pagou ou pelo administrador: method manual, byAdmin só para o administrador", () => {
		expect(a(changed(pay([sh("a", 10000)], 500, { method: "manual", actor: "o" }))).parts![0]).toEqual({ id: "p1", cents: 500, at: NOW, markedBy: "o", method: "manual" });
		expect(a(changed(pay([sh("a", 10000)], 500, { method: "manual", asAdmin: true, actor: "adm" }))).parts![0]).toMatchObject({ method: "manual", byAdmin: true, markedBy: "adm" });
	});
	it("não mexe nas outras cotas nem muda o total da despesa", () => {
		const before = [sh(OWNER, 5000), sh("a", 5000), sh("b", 5000, 5000, { paidAt: D1, markedBy: "b", method: "self" })];
		const after = changed(pay(before, 100));
		expect(after.find((s) => s.uid === "b")).toBe(before[2]);
		expect(after.reduce((t, s) => t + s.amountCents, 0)).toBe(15000);
	});
});

describe("addPayment: recusas", () => {
	it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2])("valor %s é inválido", (cents) => {
		expect(pay([sh("a", 10000)], cents)).toEqual({ error: "invalid" });
	});
	it("maior que o que falta é recusado (parcial nunca gera devolução), com ou sem parciais antes", () => {
		expect(pay([sh("a", 10000)], 10001)).toEqual({ error: "too_much" });
		const s = changed(pay([sh("a", 10000)], 4000));
		expect(pay(s, 6001)).toEqual({ error: "too_much" });
	});
	it("parte já quitada, ou em devolução, não aceita valor", () => {
		expect(pay([sh("a", 10000, 10000, { paidAt: D1, markedBy: "a", method: "self" })], 1)).toEqual({ error: "too_much" });
		expect(pay([sh("a", 10000, 12000)], 1)).toEqual({ error: "too_much" });
	});
	it("null: quem pagou a conta, cota 0 ou quem não existe", () => {
		expect(addPayment([sh(OWNER, 5000)], OWNER, OWNER, 100, NOW, OWNER, { method: "self", partId: "x" })).toBeNull();
		expect(pay([sh("a", 0, 500)], 100)).toBeNull();
		expect(pay([sh("b", 1000)], 100)).toBeNull();
	});
	it(`no máximo ${MAX_PARTS} parciais; quitar o que falta continua possível`, () => {
		let s: ExpenseShare[] = [sh("a", 100000)];
		for (let i = 0; i < MAX_PARTS; i++) s = changed(pay(s, 1, { partId: `p${i}` }));
		expect(pay(s, 1, { partId: "extra" })).toEqual({ error: "limit" });
		const rest = a(s).amountCents - a(s).paidCents;
		const done = changed(pay(s, rest, { partId: "ultimo" }));
		expect(a(done)).toMatchObject({ paidCents: 100000, method: "self" });
		expect(a(done).parts).toHaveLength(MAX_PARTS);
	});
});

describe("addPayment: valor igual ao que falta é a quitação de sempre", () => {
	it("self: mesmos campos de topo do payShare e os parciais anteriores ficam", () => {
		const first = changed(pay([sh("a", 10000)], 4700, { receipt: rc("r1"), now: D1 }));
		const done = changed(pay(first, 5300, { receipt: rc("r2"), partId: "p2", now: NOW }));
		expect(a(done)).toMatchObject({ paidCents: 10000, paidAt: NOW, markedBy: "a", method: "self", receipt: rc("r2") });
		expect(a(done).parts).toEqual(a(first).parts);
		expect(done).toEqual(payShare(first, OWNER, "a", NOW, "a", rc("r2"))!.shares);
		expect(shareStatus(a(done), OWNER)).toBe("paid");
	});
	it("manual: igual ao settleShare (com markedByAdmin quando administrador)", () => {
		const first = changed(pay([sh("a", 10000)], 4700, { method: "manual", actor: "o" }));
		const done = changed(pay(first, 5300, { method: "manual", asAdmin: true, actor: "adm" }));
		expect(a(done)).toMatchObject({ paidCents: 10000, paidAt: NOW, markedBy: "adm", method: "manual", markedByAdmin: true });
		expect(done).toEqual(settleShare(first, OWNER, "a", NOW, "adm", true)!.shares);
	});
	it("valor sem parciais antes e igual à parte inteira: quitação direta, sem parts", () => {
		expect(a(changed(pay([sh("a", 10000)], 10000)))).toEqual({ uid: "a", amountCents: 10000, paidCents: 10000, paidAt: NOW, markedBy: "a", method: "self" });
	});
});

describe("pagamento antigo nos campos de topo, parte que cresceu depois (em aberto)", () => {
	const grown = sh("a", 15000, 10000, { paidAt: D1, markedBy: "a", method: "self", receipt: rc("old") });
	it("um parcial novo passa o antigo para parts (histórico e comprovante ficam) e limpa o topo", () => {
		const next = changed(pay([grown], 1000));
		expect(a(next)).not.toHaveProperty("receipt");
		expect(a(next)).not.toHaveProperty("paidAt");
		expect(a(next).parts).toEqual([
			{ id: expect.stringMatching(/^[0-9a-f]{32}$/), cents: 10000, at: D1, markedBy: "a", method: "self", receipt: rc("old") },
			{ id: "p1", cents: 1000, at: NOW, markedBy: "a", method: "self" },
		]);
		expect(a(next).paidCents).toBe(11000);
		expect(droppedReceiptKeys([grown], next)).toEqual([]);
	});
	it("quitar o que falta depois também guarda o antigo em parts (antes o comprovante antigo se perdia)", () => {
		const next = payShare([grown], OWNER, "a", NOW, "a", rc("new"))!.shares;
		expect(a(next).receipt).toEqual(rc("new"));
		expect(a(next).parts).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{32}$/), cents: 10000, at: D1, markedBy: "a", method: "self", receipt: rc("old") }]);
		expect(droppedReceiptKeys([grown], next)).toEqual([]);
	});
});

describe("undoShare: só o último pagamento", () => {
	const twoParts = (): ExpenseShare[] => {
		let s = changed(pay([sh("a", 10000)], 1000, { partId: "p1", receipt: rc("r1"), now: D1 }));
		s = changed(pay(s, 2000, { partId: "p2", receipt: rc("r2"), now: D2 }));
		return s;
	};
	it("em aberto com parciais: remove o último parcial e volta paidCents à soma dos que ficam", () => {
		const undone = undoShare(twoParts(), OWNER, "a")!;
		expect(undone.changed).toBe(true);
		expect(a(undone.shares)).toEqual({ uid: "a", amountCents: 10000, paidCents: 1000, parts: [expect.objectContaining({ id: "p1" })] });
		const again = undoShare(undone.shares, OWNER, "a")!;
		expect(a(again.shares)).toEqual({ uid: "a", amountCents: 10000, paidCents: 0 }); // sem parts vazio
		expect(undoShare(again.shares, OWNER, "a")!.changed).toBe(false);
	});
	it("quitada depois de parciais: tira só a quitação e mantém os parciais", () => {
		const done = changed(pay(twoParts(), 7000, { partId: "p3", receipt: rc("r3") }));
		const undone = undoShare(done, OWNER, "a")!;
		expect(a(undone.shares)).toMatchObject({ paidCents: 3000, parts: [expect.objectContaining({ id: "p1" }), expect.objectContaining({ id: "p2" })] });
		for (const k of ["paidAt", "markedBy", "method", "receipt"] as const) expect(a(undone.shares)).not.toHaveProperty(k);
		expect(droppedReceiptKeys(done, undone.shares)).toEqual([rc("r3").key]);
	});
	it("desfazer um parcial solta só o comprovante dele", () => {
		const undone = undoShare(twoParts(), OWNER, "a")!;
		expect(droppedReceiptKeys(twoParts(), undone.shares)).toEqual([rc("r2").key]);
	});
	it("quitação sem parciais continua voltando a nada pago (comportamento de sempre)", () => {
		const paid = payShare([sh("a", 1000)], OWNER, "a", NOW, "a", rc("r"))!.shares;
		expect(undoShare(paid, OWNER, "a")!.shares[0]).toEqual({ uid: "a", amountCents: 1000, paidCents: 0 });
	});
	it("cota 0 com parciais não some: só some quando não resta nada pago", () => {
		const s = [sh("a", 0, 3000, { parts: [{ id: "p1", cents: 1000, at: D1, markedBy: "a", method: "self" }, { id: "p2", cents: 2000, at: D2, markedBy: "a", method: "self" }] })];
		const one = undoShare(s, OWNER, "a")!;
		expect(one.shares).toHaveLength(1);
		expect(a(one.shares)).toMatchObject({ paidCents: 1000, parts: [expect.objectContaining({ id: "p1" })] });
		expect(undoShare(one.shares, OWNER, "a")!.shares).toEqual([]);
	});
	it("devolução registrada é desfeita primeiro e os parciais não mudam", () => {
		const s = [sh("a", 500, 500, { parts: [{ id: "p1", cents: 1000, at: D1, markedBy: "a", method: "self" }], refund: { cents: 500, at: D2, markedBy: "o" } })];
		const undone = undoShare(s, OWNER, "a")!;
		expect(a(undone.shares)).toMatchObject({ paidCents: 1000, parts: [expect.objectContaining({ id: "p1" })] });
		expect(a(undone.shares)).not.toHaveProperty("refund");
	});
});

describe("quem pode desfazer o próprio parcial", () => {
	it("só o parcial que a própria pessoa avisou (self, mesmo autor), sem quitação nem devolução", () => {
		const s = a(changed(pay([sh("a", 10000)], 1000, { actor: "a" })));
		expect(canUndoOwnPart(s, "a")).toBe(true);
		expect(canUndoOwnPart(s, "x")).toBe(false);
		expect(canUndoOwnPart(a(changed(pay([sh("a", 10000)], 1000, { method: "manual", actor: "o" }))), "o")).toBe(false);
		expect(canUndoOwnPart(a(changed(pay([sh("a", 10000)], 10000))), "a")).toBe(false); // quitação não
		expect(canUndoOwnPart(sh("a", 10000), "a")).toBe(false);
	});
});

describe("recalcShares e parciais", () => {
	const withPart = (): ExpenseShare[] => [sh(OWNER, 5000), ...changed(pay([sh("a", 5000)], 2000, { receipt: rc("r1") })), sh("b", 5000)];
	it("a divisão muda e parts/comprovantes ficam; a dívida passa a ser o novo valor menos o pago", () => {
		const next = recalcShares(withPart(), OWNER, 12000, [OWNER, "a", "b"]); // 4000 cada
		expect(a(next)).toMatchObject({ amountCents: 4000, paidCents: 2000, parts: [expect.objectContaining({ id: "p1" })] });
		expect(dueCents(a(next), OWNER)).toBe(2000);
	});
	it("parte nova igual ao já pago por parciais: vira paga, sem campos de topo; leitores usam o último parcial", () => {
		const next = recalcShares(withPart(), OWNER, 6000, [OWNER, "a", "b"]); // 2000 cada
		const s = a(next);
		expect(shareStatus(s, OWNER)).toBe("paid");
		expect(s).not.toHaveProperty("paidAt");
		expect(latestPayment(s)).toMatchObject({ at: NOW, markedBy: "a", method: "self", receipt: rc("r1") });
		expect(droppedReceiptKeys(withPart(), next)).toEqual([]);
	});
	it("parte nova menor que o pago por parciais: vira devolução e o comprovante fica", () => {
		const next = recalcShares(withPart(), OWNER, 3000, [OWNER, "a", "b"]); // 1000 cada
		expect(shareStatus(a(next), OWNER)).toBe("refund");
		expect(a(next).parts).toHaveLength(1);
		expect(droppedReceiptKeys(withPart(), next)).toEqual([]);
	});
	it("quem sai da divisão depois de pagar parcialmente fica com cota 0 e os parciais", () => {
		const next = recalcShares(withPart(), OWNER, 10000, [OWNER, "b"]);
		expect(a(next)).toMatchObject({ amountCents: 0, paidCents: 2000, parts: [expect.objectContaining({ id: "p1" })] });
		expect(shareStatus(a(next), OWNER)).toBe("refund");
	});
	it("apagar despesa continua protegido: parcial conta como pagamento", () => {
		expect(hasPayments({ paidBy: OWNER, shares: withPart() })).toBe(true);
		// parciais sem paidCents (estado esdrúxulo) ainda contam
		expect(hasPayments({ paidBy: OWNER, shares: [sh("a", 1000, 0, { parts: [{ id: "p", cents: 1, at: D1, markedBy: "a", method: "self" }] })] })).toBe(true);
	});
});

describe("comprovantes de parciais", () => {
	it("receiptKeysOfShare inclui os de parts, o do topo e o da devolução", () => {
		const s = sh("a", 100, 100, {
			receipt: rc("top"),
			refund: { cents: 1, at: D1, markedBy: "o", receipt: rc("ref") },
			parts: [{ id: "p1", cents: 50, at: D1, markedBy: "a", method: "self", receipt: rc("p1") }, { id: "p2", cents: 30, at: D1, markedBy: "a", method: "self" }],
		});
		expect(receiptKeysOfShare(s).sort()).toEqual([rc("p1").key, rc("ref").key, rc("top").key].sort());
	});
	it("parcial com comprovante + quitação com outro: os dois ficam", () => {
		const first = changed(pay([sh("a", 10000)], 4700, { receipt: rc("r1") }));
		const done = changed(pay(first, 5300, { receipt: rc("r2"), partId: "p2" }));
		expect(droppedReceiptKeys(first, done)).toEqual([]);
		expect(receiptKeysOfShare(a(done)).sort()).toEqual([rc("r1").key, rc("r2").key]);
	});
	it("lote: o mesmo arquivo serve várias partes; sai só quando nenhuma o referencia", () => {
		const batch = { id: "b", totalCents: 9000, count: 2 };
		const before = [
			sh("a", 5000, 1000, { parts: [{ id: "p1", cents: 1000, at: D1, markedBy: "a", method: "self", receipt: rc("p1") }] }),
			sh("c", 4000),
		];
		const res = payShares(before, OWNER, ["a", "c"], NOW, "a", rc("lote"), batch);
		expect(res.outcomes).toEqual([{ uid: "a", result: "paid", amountCents: 4000 }, { uid: "c", result: "paid", amountCents: 4000 }]);
		const [pa] = res.shares;
		expect(pa).toMatchObject({ paidCents: 5000, receipt: rc("lote"), batch });
		expect(pa.parts).toEqual(before[0].parts); // o parcial anterior e o comprovante dele ficam
		expect(droppedReceiptKeys(before, res.shares)).toEqual([]);
		// desfazer a quitação de "a": "c" (mesma despesa) ainda usa o arquivo do lote, então nada é solto
		const undone = undoShare(res.shares, OWNER, "a")!;
		expect(droppedReceiptKeys(res.shares, undone.shares)).toEqual([]);
		expect(undone.shares.flatMap(receiptKeysOfShare)).toEqual(expect.arrayContaining([rc("lote").key, rc("p1").key]));
	});
});

describe("saldos com parcial", () => {
	it("balanceOf: a pagar/receber usa só o que falta", () => {
		const shares = [sh(OWNER, 5000), ...changed(pay([sh("a", 5000)], 2000))];
		const exp = [{ paidBy: OWNER, shares }];
		expect(balanceOf(exp, "a")).toMatchObject({ toPayCents: 3000, toReceiveCents: 0 });
		expect(balanceOf(exp, OWNER)).toMatchObject({ toReceiveCents: 3000, toPayCents: 0 });
	});
});

describe("invariante dos pagamentos: devolução descartada pela mudança da parte", () => {
	const part = (id: string, cents: number, at: Date, receipt?: ShareReceipt) => ({ id, cents, at, markedBy: "a", method: "self" as const, ...(receipt ? { receipt } : {}) });
	const noProblems = (s: ExpenseShare) => expect(checkShareInvariant(s)).toEqual([]);

	it("cenário da revisão: parciais [10, 5], parte cai para 12, dono devolve 3, parte sobe para 20: o devolvido sai do mais recente", () => {
		const p1 = part("p1", 1000, D1, rc("r1"));
		const p2 = part("p2", 500, D2, rc("r2"));
		const start = [sh(OWNER, 1500), sh("a", 1500, 1500, { parts: [p1, p2] })];
		noProblems(a(start));
		const down = recalcShares(start, OWNER, 2400, [OWNER, "a"]); // parte 1200: 300 a mais
		noProblems(a(down));
		expect(shareStatus(a(down), OWNER)).toBe("refund");
		const refunded = settleShare(down, OWNER, "a", NOW, OWNER)!.shares;
		expect(a(refunded)).toMatchObject({ paidCents: 1200, refund: { cents: 300 } });
		noProblems(a(refunded));
		const up = recalcShares(refunded, OWNER, 4000, [OWNER, "a"]); // parte 2000: o registro da devolução cai
		const s = a(up);
		noProblems(s);
		expect(s).not.toHaveProperty("refund");
		expect(s.paidCents).toBe(1200);
		expect(s.parts!.map((p) => [p.id, p.cents])).toEqual([["p1", 1000], ["p2", 200]]); // os 300 saíram do mais recente (o de 500)
		expect(droppedReceiptKeys(refunded, up)).toEqual([]); // nenhum pagamento saiu inteiro: os dois comprovantes ficam
		// desfazer o último (agora 200) deixa paid 1000 = soma dos parciais, e seguir pagando funciona
		const undone = undoShare(up, OWNER, "a")!.shares;
		noProblems(a(undone));
		expect(a(undone)).toMatchObject({ paidCents: 1000 });
		noProblems(a(changed(pay(undone, 500, { partId: "p9" }))));
	});
	it("devolução maior que o último pagamento consome vários, e o que saiu inteiro perde o comprovante", () => {
		const start = [sh("a", 600, 600, { parts: [part("p1", 100, D1, rc("r1")), part("p2", 200, D2, rc("r2"))], paidAt: NOW, markedBy: "a", method: "self", receipt: rc("top") })];
		// total 600: parciais 300 + topo 300; a parte cai para 100 e o dono devolve 500
		const refunded = settleShare(recalcShares([sh(OWNER, 0), ...start], OWNER, 200, [OWNER, "a"]), OWNER, "a", NOW, OWNER)!.shares;
		noProblems(a(refunded));
		expect(a(refunded)).toMatchObject({ paidCents: 100, refund: { cents: 500 } });
		const up = recalcShares(refunded, OWNER, 5000, [OWNER, "a"]);
		noProblems(a(up));
		// 500 devolvidos: o topo (300) sai inteiro, depois 200 do parcial mais novo (200) sai inteiro; sobra o parcial de 100
		expect(a(up)).toMatchObject({ paidCents: 100, parts: [expect.objectContaining({ id: "p1", cents: 100 })] });
		expect(a(up)).not.toHaveProperty("receipt");
		expect(droppedReceiptKeys(refunded, up).sort()).toEqual([rc("r2").key, rc("top").key].sort());
	});
	it("a pessoa sai da divisão depois de devolvida: parciais e topo ficam coerentes", () => {
		const start = [sh(OWNER, 1000), sh("a", 1000, 1500, { parts: [part("p1", 1500, D1)] })];
		const refunded = settleShare(start, OWNER, "a", NOW, OWNER)!.shares;
		noProblems(a(refunded));
		const left = recalcShares(refunded, OWNER, 1000, [OWNER]);
		noProblems(a(left));
		expect(a(left)).toMatchObject({ amountCents: 0, paidCents: 1000 });
	});
});

describe("o último pagamento (latestPayment): uma só regra, na ordem de REGISTRO (nunca o relógio)", () => {
	const part = (id: string, cents: number, at: Date, markedBy = "a", method: "self" | "manual" = "self") => ({ id, cents, at, markedBy, method });
	// parte de R$ 100,00 com parcial de R$ 20,00 e quitada com R$ 80,00; a despesa sobe e a parte volta a ficar pendente COM pagamento de topo
	const grown = (): ExpenseShare => sh("a", 15000, 10000, { parts: [part("p1", 2000, D1)], paidAt: D2, markedBy: "a", method: "self", receipt: rc("quit") });
	const noProblems = (s: ExpenseShare) => expect(checkShareInvariant(s)).toEqual([]);
	it("o de topo, se existe, é o último; senão o último parcial do array (datas só para exibir)", () => {
		expect(latestPayment(grown())).toMatchObject({ kind: "top", cents: 8000 });
		// parcial com data MAIS NOVA que a do topo: o topo continua sendo o último (foi registrado depois)
		const newerPart = sh("a", 15000, 10000, { parts: [part("p1", 2000, D2)], paidAt: D1, markedBy: "a", method: "self" });
		expect(latestPayment(newerPart)).toMatchObject({ kind: "top", cents: 8000 });
		const tieParts = sh("a", 15000, 5000, { parts: [part("p1", 2000, D2), part("p2", 3000, D1)] });
		expect(latestPayment(tieParts)).toMatchObject({ kind: "part", index: 1, cents: 3000 }); // data menor, mas é o último do array
		expect(latestPayment(sh("a", 100, 0))).toBeUndefined();
	});
	it("relógio atrasado: a pessoa toca 'Já paguei' em T0, o dono registra parcial em T1 > T0 e a quitação grava com paidAt = T0: o topo é o último", () => {
		const T0 = new Date("2026-11-11T12:00:00Z");
		const T1 = new Date("2026-11-11T12:00:30Z");
		let s: ExpenseShare[] = [sh("a", 10000)];
		s = changed(pay(s, 1000, { method: "manual", actor: "o", now: T1, partId: "dono" })); // T1 registrado primeiro
		s = payShare(s, OWNER, "a", T0, "a", rc("quit"))!.shares; // quitação com data anterior (T0)
		expect(latestPayment(a(s))).toMatchObject({ kind: "top", cents: 9000, markedBy: "a", method: "self" });
		noProblems(a(s));
		const undone = undoShare(s, OWNER, "a")!.shares;
		expect(a(undone)).toMatchObject({ paidCents: 1000, parts: [expect.objectContaining({ id: "dono" })] });
		expect(droppedReceiptKeys(s, undone)).toEqual([rc("quit").key]);
	});
	it("desfazer tira exatamente o que latestPayment aponta (o de R$ 80,00 e o comprovante dele; o de R$ 20,00 fica)", () => {
		const g = grown();
		noProblems(g);
		const undone = undoShare([g], OWNER, "a")!.shares[0];
		expect(undone).toMatchObject({ paidCents: 2000, parts: [expect.objectContaining({ id: "p1", cents: 2000 })] });
		expect(undone).not.toHaveProperty("receipt");
		noProblems(undone);
		expect(droppedReceiptKeys([g], [undone])).toEqual([rc("quit").key]);
	});
	it("canUndoOwnPart usa a mesma função: só quando o último é um parcial self do próprio autor", () => {
		expect(canUndoOwnPart(grown(), "a")).toBe(false); // o último é a quitação
		const own = sh("a", 15000, 2000, { parts: [part("p1", 2000, D1, "a")] });
		expect(canUndoOwnPart(own, "a")).toBe(true);
		const byOther = sh("a", 15000, 3000, { parts: [part("p1", 2000, D1, "a"), part("p2", 1000, D2, "o", "manual")] });
		expect(canUndoOwnPart(byOther, "a")).toBe(false); // o último foi marcado por outro: recusado
		expect(canUndoOwnPart(byOther, "o")).toBe(false); // manual nunca vale como "aviso da própria pessoa"
		// datas trocadas não mudam nada: vale a ordem do array
		const swapped = sh("a", 15000, 3000, { parts: [part("p1", 2000, D2, "a"), part("p2", 1000, D1, "o", "manual")] });
		expect(canUndoOwnPart(swapped, "a")).toBe(false);
	});
	it("dropRefund usa a mesma ordem: o devolvido sai do último registrado, não do mais novo por data", () => {
		const s = sh("a", 1200, 1200, { parts: [part("p1", 1000, D2), part("p2", 500, D1)], refund: { cents: 300, at: NOW, markedBy: OWNER } });
		noProblems(s);
		const up = recalcShares([sh(OWNER, 0), s], OWNER, 4000, [OWNER, "a"]);
		expect(a(up).parts!.map((p) => [p.id, p.cents])).toEqual([["p1", 1000], ["p2", 200]]);
	});
	it("ids de parciais são únicos mesmo com vários pagamentos antigos rebaixados", () => {
		let s: ExpenseShare[] = [sh("a", 15000, 10000, { paidAt: D1, markedBy: "a", method: "self" })];
		s = changed(pay(s, 100, { partId: "x1" })); // rebaixa o antigo (id aleatório)
		s = [{ ...s[0], amountCents: 30000, paidAt: D2, markedBy: "a", method: "self", paidCents: s[0].paidCents + 5000 }]; // volta a ter topo
		s = changed(pay(s, 100, { partId: "x2" }));
		const ids = a(s).parts!.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
		noProblems(a(s));
	});
});

describe("modelo antigo: o pagamento de topo é estrutural (com ou sem metadados)", () => {
	const noProblems = (s: ExpenseShare) => expect(checkShareInvariant(s)).toEqual([]);
	const legacy = () => sh("a", 15000, 10000); // paga R$ 100,00 antes de a parte crescer; sem paidAt/markedBy/method/receipt
	it("existe topo sempre que total - parciais > 0; aparece como 'pago', sem data nem quem", () => {
		expect(hasTopPayment(legacy())).toBe(true);
		expect(topCentsOf(legacy())).toBe(10000);
		expect(latestPayment(legacy())).toMatchObject({ kind: "top", cents: 10000, markedBy: "" });
		expect(latestPayment(legacy())?.method).toBeUndefined();
		const viaStatus = normalizeShares([{ uid: "a", amountCents: 10000, status: "paid" } as unknown as ExpenseShare])[0];
		expect(viaStatus.paidCents).toBe(10000);
		expect(hasTopPayment(viaStatus)).toBe(true);
	});
	it("entrar um parcial rebaixa o valor antigo (sem o perder) e a invariante vale", () => {
		const next = changed(pay([legacy()], 500, { partId: "n1" }));
		noProblems(a(next));
		expect(a(next)).toMatchObject({ paidCents: 10500 });
		expect(a(next).parts!.map((p) => p.cents)).toEqual([10000, 500]);
		expect(hasTopPayment(a(next))).toBe(false);
		// desfazer o parcial devolve ao legado (valor antigo intacto)
		const undone = undoShare(next, OWNER, "a")!.shares;
		noProblems(a(undone));
		expect(a(undone).paidCents).toBe(10000);
	});
	it("quitar rebaixa o antigo e o novo vira o topo; desfazer a quitação volta a 100 pago", () => {
		const paid = payShare([legacy()], OWNER, "a", NOW, "a")!.shares;
		noProblems(a(paid));
		expect(a(paid)).toMatchObject({ paidCents: 15000, method: "self" });
		expect(a(paid).parts!.map((p) => p.cents)).toEqual([10000]);
		const undone = undoShare(paid, OWNER, "a")!.shares;
		noProblems(a(undone));
		expect(a(undone).paidCents).toBe(10000);
	});
	it("desfazer o legado: volta a nada pago; e devolução + dropRefund funcionam", () => {
		expect(undoShare([legacy()], OWNER, "a")!.shares[0]).toEqual({ uid: "a", amountCents: 15000, paidCents: 0 });
		// pagou a mais (sem metadados), o dono devolve, a parte sobe: o devolvido sai do topo e a invariante vale
		const over = sh("a", 4000, 6000);
		const refunded = settleShare([over], OWNER, "a", NOW, OWNER)!.shares;
		noProblems(a(refunded));
		const up = recalcShares([sh(OWNER, 0), ...refunded], OWNER, 20000, [OWNER, "a"]);
		noProblems(a(up));
		expect(a(up)).toMatchObject({ paidCents: 4000 });
		expect(hasTopPayment(a(up))).toBe(true);
	});
});

describe("teto de parciais e o rebaixamento do topo", () => {
	const noProblems = (s: ExpenseShare) => expect(checkShareInvariant(s)).toEqual([]);
	const full = (): ExpenseShare[] => {
		let s: ExpenseShare[] = [sh("a", 1_000_000)];
		for (let i = 0; i < MAX_PARTS; i++) s = changed(pay(s, 1, { partId: `p${i}` }));
		return s;
	};
	it("rebaixar o topo pode passar do teto, mas isso nunca trava a parte: quitar continua possível", () => {
		// parte com 20 parciais quitada, depois cresceu (topo + 20 parciais)
		const quitted = changed(pay(full(), 1_000_000 - MAX_PARTS, { partId: "q" }));
		noProblems(a(quitted));
		const grown = [{ ...a(quitted), amountCents: 2_000_000 }];
		// novo parcial: recusado (rebaixar o topo passaria de 20), sem mexer em nada
		expect(pay(grown, 5)).toEqual({ error: "limit" });
		// quitar o que falta: sempre possível; o antigo é rebaixado (21 parciais) e o novo é o topo
		const done = payShare(grown, OWNER, "a", NOW, "a", rc("fim"))!.shares;
		noProblems(a(done));
		expect(a(done).parts!.length).toBe(MAX_PARTS + 1);
		expect(a(done).paidCents).toBe(2_000_000);
		// desfazer a quitação continua coerente, e o parcial só volta a ser aceito depois de desfazer o excesso
		const undone = undoShare(done, OWNER, "a")!.shares;
		noProblems(a(undone));
		expect(a(undone).parts!.length).toBe(MAX_PARTS + 1);
		expect(pay(undone, 5)).toEqual({ error: "limit" });
		let s = undone;
		s = undoShare(s, OWNER, "a")!.shares;
		s = undoShare(s, OWNER, "a")!.shares;
		noProblems(a(s));
		expect(a(s).parts!.length).toBe(MAX_PARTS - 1);
		expect(a(changed(pay(s, 5, { partId: "novo" }))).parts!.length).toBe(MAX_PARTS);
	});
});

describe("trocar comprovante só quando o último pagamento foi aviso da própria pessoa", () => {
	const part = (id: string, cents: number, markedBy: string, method: "self" | "manual", receipt?: ShareReceipt) => ({ id, cents, at: D1, markedBy, method, ...(receipt ? { receipt } : {}) });
	it("último pagamento é parcial manual (dono/admin) com comprovante: não troca nada e nada é apagado", () => {
		const s = sh("a", 1000, 1000, { parts: [part("p1", 600, "a", "self", rc("meu")), part("p2", 400, OWNER, "manual", rc("dono"))] });
		expect(checkShareInvariant(s)).toEqual([]);
		const r = payShare([s], OWNER, "a", NOW, "a", rc("novo"))!;
		expect(r.changed).toBe(false);
		expect(r.shares[0]).toBe(s);
	});
	it("último pagamento é o de topo marcado pelo dono: a mesma brecha estava fechada para o topo manual com comprovante", () => {
		const s = sh("a", 1000, 1000, { paidAt: D1, markedBy: OWNER, method: "manual", receipt: rc("dono") });
		expect(payShare([s], OWNER, "a", NOW, "a", rc("novo"))!.changed).toBe(false);
	});
	it("anexar quando ainda não há comprovante (manual sem arquivo) continua possível; trocar o próprio (self) também", () => {
		const manual = sh("a", 1000, 1000, { paidAt: D1, markedBy: OWNER, method: "manual" });
		expect(payShare([manual], OWNER, "a", NOW, "a", rc("meu"))!.shares[0].receipt).toEqual(rc("meu"));
		const own = sh("a", 1000, 1000, { paidAt: D1, markedBy: "a", method: "self", receipt: rc("velho") });
		expect(payShare([own], OWNER, "a", NOW, "a", rc("novo"))!.shares[0].receipt).toEqual(rc("novo"));
		const ownPart = sh("a", 1000, 1000, { parts: [part("p1", 1000, "a", "self", rc("velho"))] });
		expect(payShare([ownPart], OWNER, "a", NOW, "a", rc("novo"))!.shares[0].parts![0].receipt).toEqual(rc("novo"));
	});
});

describe("desfazer com conferência (undoShareIfCurrent)", () => {
	const part = (id: string, cents: number) => ({ id, cents, at: D1, markedBy: "a", method: "self" as const });
	it("expectedPaidCents igual: desfaz; diferente: recusa sem desfazer", () => {
		const s = [sh("a", 1000, 300, { parts: [part("p1", 100), part("p2", 200)] })];
		expect(undoShareIfCurrent(s, OWNER, "a", 100)).toEqual({ error: "stale" });
		const ok = undoShareIfCurrent(s, OWNER, "a", 300) as { shares: ExpenseShare[] };
		expect(ok.shares[0].paidCents).toBe(100);
	});
	it("sem o campo (cliente antigo): vale só quando a parte não tem parciais; com parciais recusa", () => {
		expect(undoShareIfCurrent([sh("a", 1000, 300, { parts: [part("p1", 300)] })], OWNER, "a")).toEqual({ error: "stale" });
		const noParts = sh("a", 1000, 1000, { paidAt: D1, markedBy: OWNER, method: "manual" });
		expect(undoShareIfCurrent([noParts], OWNER, "a")).toMatchObject({ changed: true });
	});
});

describe("parts malformado vindo do banco nunca lança (normalização num ponto só)", () => {
	const good = { id: "p1", cents: 300, at: new Date("2026-11-01T10:00:00Z"), markedBy: "a", method: "self" as const };
	const run = (parts: unknown) => normalizeShares([{ uid: "a", amountCents: 1000, paidCents: 300, parts } as unknown as ExpenseShare])[0];
	it("não é lista: ignora", () => {
		for (const bad of ["x", 5, {}, { 0: good }, true, null]) {
			const s = run(bad);
			expect(s).not.toHaveProperty("parts");
			expect(() => [latestPayment(s), topCentsOf(s), checkShareInvariant(s), receiptKeysOfShare(s), canUndoOwnPart(s, "a")]).not.toThrow();
		}
	});
	it("elementos nulos ou malformados são ignorados; os válidos ficam", () => {
		const s = run([null, undefined, 7, "x", [], { id: "", cents: 5, method: "self", at: new Date() }, { id: "a", cents: -1, method: "self", at: new Date() }, { id: "b", cents: 1.5, method: "self", at: new Date() }, { id: "c", cents: 5, method: "zzz", at: new Date() }, { id: "d", cents: 5, method: "self", at: "lixo" }, good]);
		expect(s.parts).toEqual([good]);
		expect(() => [latestPayment(s), partsPaidCents(s), receiptKeysOfShare(s)]).not.toThrow();
		// receipt/batch inválidos são descartados, o resto do parcial fica
		const r = run([{ ...good, receipt: 5, batch: "x" }]);
		expect(r.parts).toEqual([good]);
		expect(run([null]).parts).toBeUndefined();
		expect(run([]).parts).toBeUndefined();
	});
	it("parciais válidos passam sem cópia (o caso normal não aloca)", () => {
		const shares = [{ uid: "a", amountCents: 1000, paidCents: 300, parts: [good] }];
		expect(normalizeShares(shares)).toBe(shares);
	});
	it("datas gravadas como texto viram Date", () => {
		expect(run([{ ...good, at: "2026-11-01T10:00:00.000Z" }]).parts![0].at).toEqual(good.at);
	});
});
