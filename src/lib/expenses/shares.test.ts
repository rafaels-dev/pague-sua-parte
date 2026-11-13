import { describe, expect, it } from "vitest";
import {
	refundShares,
	balanceOf,
	dueCents,
	droppedReceiptKeys,
	hasPayments,
	normalizeShare,
	orderShares,
	participantUidsOf,
	payShare,
	payShares,
	recalcShares,
	refundCents,
	settleShare,
	shareStatus,
	undoShare,
	type ExpenseShare,
} from "./shares";

const OWNER = "o";
const sh = (uid: string, amountCents: number, paidCents = 0, extra: Partial<ExpenseShare> = {}): ExpenseShare => ({ uid, amountCents, paidCents, ...extra });
const total = (shares: ExpenseShare[]) => shares.reduce((a, s) => a + s.amountCents, 0);
const NOW = new Date("2026-11-11T12:00:00Z");

describe("derivação: status, dueCents, refundCents", () => {
	it.each([
		// [share, status, due, refund]
		[sh(OWNER, 1000, 0), "payer", 0, 0],
		[sh(OWNER, 1000, 999), "payer", 0, 0], // paidCents do dono é irrelevante
		[sh("a", 1000, 0), "pending", 1000, 0],
		[sh("a", 1000, 1), "pending", 999, 0],
		[sh("a", 1000, 999), "pending", 1, 0],
		[sh("a", 1000, 1000), "paid", 0, 0],
		[sh("a", 1000, 1001), "refund", 0, 1],
		[sh("a", 0, 500), "refund", 0, 500],
		[sh("a", 333, 1000), "refund", 0, 667],
		[sh("a", 0, 0), "paid", 0, 0], // não deveria existir; nada é devido
	] as const)("%j", (s, status, due, refund) => {
		expect(shareStatus(s, OWNER)).toBe(status);
		expect(dueCents(s, OWNER)).toBe(due);
		expect(refundCents(s, OWNER)).toBe(refund);
	});
});

describe("recalcShares", () => {
	const create = (amount: number, uids: string[]) => recalcShares([], OWNER, amount, uids);

	it("só o dono participando", () => {
		expect(create(3000, [OWNER])).toEqual([sh(OWNER, 3000)]);
	});
	it("divide igualmente e a sobra fica com o dono", () => {
		const r = create(1000, [OWNER, "a", "b"]);
		expect(r.map((s) => s.amountCents)).toEqual([334, 333, 333]);
		expect(total(r)).toBe(1000);
	});
	it("adiciona pessoa depois que alguém pagou: aparece reembolso", () => {
		let shares = create(3000, [OWNER, "a", "b"]); // 1000 cada
		shares = settleShare(shares, OWNER, "a", NOW, OWNER)!.shares; // a pagou 1000
		shares = recalcShares(shares, OWNER, 3000, [OWNER, "a", "b", "c"]); // 750 cada
		const a = shares.find((s) => s.uid === "a")!;
		expect(a).toMatchObject({ amountCents: 750, paidCents: 1000, paidAt: NOW, markedBy: OWNER, method: "manual" });
		expect(shareStatus(a, OWNER)).toBe("refund");
		expect(refundCents(a, OWNER)).toBe(250);
		expect(dueCents(shares.find((s) => s.uid === "c")!, OWNER)).toBe(750);
		expect(total(shares)).toBe(3000);
	});
	it("remove quem não pagou: a cota some", () => {
		const shares = recalcShares(create(3000, [OWNER, "a", "b"]), OWNER, 3000, [OWNER, "a"]);
		expect(shares.map((s) => s.uid)).toEqual([OWNER, "a"]);
		expect(total(shares)).toBe(3000);
	});
	it("remove quem pagou: fica com cota 0 e o pagamento todo a reembolsar", () => {
		let shares = settleShare(create(3000, [OWNER, "a", "b"]), OWNER, "b", NOW, OWNER)!.shares;
		shares = recalcShares(shares, OWNER, 3000, [OWNER, "a"]);
		const b = shares.find((s) => s.uid === "b")!;
		expect(b).toMatchObject({ amountCents: 0, paidCents: 1000 });
		expect(shareStatus(b, OWNER)).toBe("refund");
		expect(refundCents(b, OWNER)).toBe(1000);
		expect(participantUidsOf(shares)).toEqual([OWNER, "a"]);
		expect(total(shares)).toBe(3000);
	});
	it("volta a incluir quem tinha sido removido: mantém o que pagou", () => {
		let shares = settleShare(create(3000, [OWNER, "a", "b"]), OWNER, "b", NOW, OWNER)!.shares;
		shares = recalcShares(shares, OWNER, 3000, [OWNER, "a"]);
		shares = recalcShares(shares, OWNER, 3000, [OWNER, "a", "b"]);
		const b = shares.find((s) => s.uid === "b")!;
		expect(b).toMatchObject({ amountCents: 1000, paidCents: 1000, paidAt: NOW });
		expect(shareStatus(b, OWNER)).toBe("paid");
	});
	it("quem pagou menos que a nova cota só deve a diferença", () => {
		let shares = settleShare(create(2000, [OWNER, "a"]), OWNER, "a", NOW, OWNER)!.shares; // a pagou 1000
		shares = recalcShares(shares, OWNER, 2000, [OWNER, "a"]);
		expect(dueCents(shares[1], OWNER)).toBe(0);
		shares = recalcShares(shares, OWNER, 2000, [OWNER, "a", "b", "c", "d"]); // 400 cada
		expect(refundCents(shares.find((s) => s.uid === "a")!, OWNER)).toBe(600);
	});
	it("dono fora da divisão: não tem cota; dono volta: cota nova sem pagamento", () => {
		let shares = recalcShares(create(3000, [OWNER, "a", "b"]), OWNER, 3000, ["a", "b"]);
		expect(shares.some((s) => s.uid === OWNER)).toBe(false);
		expect(shares.map((s) => s.amountCents)).toEqual([1500, 1500]);
		expect(total(shares)).toBe(3000);
		shares = recalcShares(shares, OWNER, 3000, [OWNER, "a", "b"]);
		expect(shares[0]).toEqual(sh(OWNER, 1000));
	});
	it("dono sozinho depois de todos pagarem: todos viram reembolso integral", () => {
		let shares = create(3000, [OWNER, "a", "b"]);
		shares = settleShare(settleShare(shares, OWNER, "a", NOW, OWNER)!.shares, OWNER, "b", NOW, OWNER)!.shares;
		shares = recalcShares(shares, OWNER, 3000, [OWNER]);
		expect(shares.map((s) => [s.uid, s.amountCents, s.paidCents])).toEqual([[OWNER, 3000, 0], ["a", 0, 1000], ["b", 0, 1000]]);
	});
	it("o total sempre fecha em qualquer combinação de participantes", () => {
		for (const amount of [1, 7, 100, 3333, 100000]) {
			const all = [OWNER, "a", "b", "c", "d"];
			for (let mask = 1; mask < 32; mask++) {
				const uids = all.filter((_, i) => mask & (1 << i));
				if (amount < uids.length) continue;
				expect(total(recalcShares([], OWNER, amount, uids))).toBe(amount);
			}
		}
	});
	it("valor menor que o número de participantes lança", () => {
		expect(() => recalcShares([], OWNER, 2, [OWNER, "a", "b"])).toThrow();
	});
});

describe("settleShare / undoShare", () => {
	const base = [sh(OWNER, 1000), sh("a", 1000), sh("r", 0, 400, { paidAt: NOW, markedBy: OWNER, method: "manual" })];

	it("quitar pendente", () => {
		const r = settleShare(base, OWNER, "a", NOW, OWNER)!;
		expect(r.changed).toBe(true);
		expect(r.shares[1]).toEqual(sh("a", 1000, 1000, { paidAt: NOW, markedBy: OWNER, method: "manual" }));
	});
	it("quitar parcialmente pago paga só o resto (paidCents vira o valor da cota)", () => {
		const r = settleShare([sh(OWNER, 1000), sh("a", 1000, 300)], OWNER, "a", NOW, OWNER)!;
		expect(r.shares[1].paidCents).toBe(1000);
	});
	it("quitar reembolso de não participante mantém a linha, com o registro da devolução", () => {
		const r = settleShare(base, OWNER, "r", NOW, OWNER)!;
		expect(r.shares.map((s) => s.uid)).toEqual([OWNER, "a", "r"]);
		expect(r.shares[2]).toMatchObject({ amountCents: 0, paidCents: 0, refund: { cents: 400, markedBy: OWNER, at: NOW } });
	});
	it("quitar reembolso de quem ainda participa: paidCents iguala a cota", () => {
		const r = settleShare([sh(OWNER, 500), sh("a", 750, 1000, { paidAt: NOW })], OWNER, "a", new Date(), OWNER)!;
		expect(r.shares[1]).toMatchObject({ amountCents: 750, paidCents: 750, paidAt: NOW, refund: { cents: 250, markedBy: OWNER } });
		expect(shareStatus(r.shares[1], OWNER)).toBe("paid");
	});
	it("idempotente: quitar de novo não muda paidAt", () => {
		const once = settleShare(base, OWNER, "a", NOW, OWNER)!;
		const twice = settleShare(once.shares, OWNER, "a", new Date("2030-01-01"), OWNER)!;
		expect(twice.changed).toBe(false);
		expect(twice.shares[1].paidAt).toEqual(NOW);
	});
	it("desfazer volta a pendente e limpa os campos", () => {
		const paid = settleShare(base, OWNER, "a", NOW, OWNER)!.shares;
		const r = undoShare(paid, OWNER, "a")!;
		expect(r.shares[1]).toEqual(sh("a", 1000, 0));
		expect("paidAt" in r.shares[1]).toBe(false);
	});
	it("desfazer em não participante remove a linha; desfazer de novo é idempotente", () => {
		const r = undoShare(base, OWNER, "r")!;
		expect(r.shares.map((s) => s.uid)).toEqual([OWNER, "a"]);
		const again = undoShare(base, OWNER, "a")!;
		expect(again.changed).toBe(false);
	});
	it("alvo é o dono ou não tem cota: null", () => {
		expect(settleShare(base, OWNER, OWNER, NOW, OWNER)).toBeNull();
		expect(settleShare(base, OWNER, "zz", NOW, OWNER)).toBeNull();
		expect(undoShare(base, OWNER, OWNER)).toBeNull();
		expect(undoShare(base, OWNER, "zz")).toBeNull();
	});
	it("não muta a entrada", () => {
		const copy = structuredClone(base);
		settleShare(base, OWNER, "a", NOW, OWNER);
		undoShare(base, OWNER, "r");
		expect(base).toEqual(copy);
	});
});

describe("hasPayments / orderShares", () => {
	it("ignora a cota do dono", () => {
		expect(hasPayments({ paidBy: OWNER, shares: [sh(OWNER, 10, 10), sh("a", 10)] })).toBe(false);
		expect(hasPayments({ paidBy: OWNER, shares: [sh(OWNER, 10), sh("a", 10, 1)] })).toBe(true);
		expect(hasPayments({ paidBy: OWNER, shares: [sh(OWNER, 10), sh("a", 0, 5)] })).toBe(true);
	});
	it("dono, depois participantes por nome, depois reembolsos", () => {
		const names: Record<string, string> = { o: "Zé", a: "Carla", b: "Ana", r: "Aaa" };
		const out = orderShares([sh("r", 0, 5), sh("a", 5), sh("b", 5), sh(OWNER, 5)], OWNER, (u) => names[u]);
		expect(out.map((s) => s.uid)).toEqual([OWNER, "b", "a", "r"]);
	});
});

describe("balanceOf (fixture calculada à mão)", () => {
	// u1 é dono de E1 e E2; u2 é dono de E3.
	const E1 = { paidBy: "u1", shares: [sh("u1", 1000), sh("u2", 1000, 0), sh("u3", 1000, 1000)] }; // u2 deve 1000
	const E2 = { paidBy: "u1", shares: [sh("u1", 500), sh("u2", 500, 800), sh("u3", 0, 200)] }; // u1 deve 300 a u2 e 200 a u3
	const E3 = { paidBy: "u2", shares: [sh("u2", 600), sh("u1", 600, 100), sh("u3", 600, 600)] }; // u1 deve 500 a u2
	it("u1", () => {
		// a receber: E1 u2 1000 | a pagar: E2 300+200, E3 500
		expect(balanceOf([E1, E2, E3], "u1")).toEqual({ toReceiveCents: 1000, toPayCents: 1000, toReceiveNowCents: 1000, toPayNowCents: 1000, overdueToPayCents: 0 });
	});
	it("u2", () => {
		// a pagar: E1 1000 | a receber: E2 refund 300, E3 500
		expect(balanceOf([E1, E2, E3], "u2")).toEqual({ toReceiveCents: 800, toPayCents: 1000, toReceiveNowCents: 800, toPayNowCents: 1000, overdueToPayCents: 0 });
	});
	it("u3", () => {
		// a receber: E2 refund 200
		expect(balanceOf([E1, E2, E3], "u3")).toEqual({ toReceiveCents: 200, toPayCents: 0, toReceiveNowCents: 200, toPayNowCents: 0, overdueToPayCents: 0 });
	});
	it("dinheiro se conserva: o que um deve, outro recebe", () => {
		const all = ["u1", "u2", "u3"].map((u) => balanceOf([E1, E2, E3], u));
		expect(all.reduce((a, b) => a + b.toReceiveCents, 0)).toBe(all.reduce((a, b) => a + b.toPayCents, 0));
	});
});

describe("balanceOf: agora x depois x atrasado (fixture calculada à mão, hoje = 2026-11-11 em São Paulo)", () => {
	const NOW = new Date("2026-11-11T15:00:00Z"); // fim do mês: 2026-11-30
	const owned = (paidBy: string, dueDate: string | undefined, ...shares: ReturnType<typeof sh>[]) => ({ paidBy, dueDate, shares });
	const ex = [
		owned("u1", undefined, sh("u1", 0), sh("u2", 100, 0)), // sem vencimento: agora
		owned("u1", "2026-11-05", sh("u2", 200, 0)), // atrasada
		owned("u1", "2026-11-30", sh("u2", 300, 0)), // último dia do mês: agora, não atrasada
		owned("u1", "2026-12-01", sh("u2", 400, 0)), // depois
		owned("u1", "2027-06-01", sh("u2", 300, 500), sh("u3", 50, 0)), // u2 pagou a mais: reembolso 200 conta agora; 50 de u3 é depois
		owned("u2", "2026-12-15", sh("u1", 700, 0)), // u1 deve, depois
		owned("u2", "2026-11-01", sh("u1", 60, 0)), // u1 deve, atrasada
	];
	it("u1", () => {
		expect(balanceOf(ex, "u1", NOW)).toEqual({
			toReceiveCents: 1050, // 100+200+300+400+50
			toReceiveNowCents: 600, // 100+200+300
			toPayCents: 960, // reembolso 200 + 700 + 60
			toPayNowCents: 260, // reembolso 200 + 60
			overdueToPayCents: 60,
		});
	});
	it("u2", () => {
		expect(balanceOf(ex, "u2", NOW)).toEqual({
			toPayCents: 1000,
			toPayNowCents: 600,
			overdueToPayCents: 200, // só a de 2026-11-05 (a sem vencimento nunca atrasa)
			toReceiveCents: 960, // 700 + 60 + reembolso 200
			toReceiveNowCents: 260, // 60 + reembolso 200
		});
	});
	it("u3", () => {
		expect(balanceOf(ex, "u3", NOW)).toEqual({ toPayCents: 50, toPayNowCents: 0, overdueToPayCents: 0, toReceiveCents: 0, toReceiveNowCents: 0 });
	});
	it("a virada de dia é em São Paulo: 23:59:59 ainda não atrasa, 00:00:00 do dia seguinte atrasa", () => {
		const e = [owned("u1", "2026-11-11", sh("u2", 100, 0))];
		expect(balanceOf(e, "u2", new Date("2026-11-12T02:59:59Z")).overdueToPayCents).toBe(0);
		expect(balanceOf(e, "u2", new Date("2026-11-12T03:00:00Z")).overdueToPayCents).toBe(100);
	});
	it("a virada de mês também: 'agora' passa a incluir o mês seguinte", () => {
		const e = [owned("u1", "2026-12-01", sh("u2", 100, 0))];
		expect(balanceOf(e, "u2", new Date("2026-12-01T02:59:59Z")).toPayNowCents).toBe(0); // ainda 30/11 em SP
		expect(balanceOf(e, "u2", new Date("2026-12-01T03:00:00Z")).toPayNowCents).toBe(100);
	});
});

describe("comprovantes: payShare, undoShare, recalcShares", () => {
	const R = { id: "r1", key: "receipts/g/e/r1", name: "pix.png", contentType: "image/png", size: 4 };
	const R2 = { ...R, id: "r2", key: "receipts/g/e/r2" };
	const base = [sh(OWNER, 1000), sh("a", 1000), sh("b", 1000)];

	it("pendente: quita como self com comprovante opcional", () => {
		const r = payShare(base, OWNER, "a", NOW, "a", R)!;
		expect(r.changed).toBe(true);
		expect(r.shares[1]).toEqual({ uid: "a", amountCents: 1000, paidCents: 1000, paidAt: NOW, markedBy: "a", method: "self", receipt: R });
		const plain = payShare(base, OWNER, "a", NOW, "a")!;
		expect(plain.shares[1]).not.toHaveProperty("receipt");
		expect(plain.shares[1].method).toBe("self");
	});
	it("quitada: com arquivo só troca o comprovante; sem arquivo é no-op", () => {
		const paid = payShare(base, OWNER, "a", NOW, "a", R)!.shares;
		const later = new Date("2026-12-01T00:00:00Z");
		const swap = payShare(paid, OWNER, "a", later, "outro", R2)!;
		expect(swap.shares[1]).toMatchObject({ paidAt: NOW, markedBy: "a", method: "self", receipt: R2 });
		expect(droppedReceiptKeys(paid, swap.shares)).toEqual([R.key]);
		expect(payShare(paid, OWNER, "a", later, "a")).toEqual({ shares: paid, changed: false });
	});
	it("quitada pelo dono (manual) e depois comprovante: mantém method manual", () => {
		const manual = settleShare(base, OWNER, "a", NOW, OWNER)!.shares;
		expect(payShare(manual, OWNER, "a", NOW, "a", R)!.shares[1]).toMatchObject({ method: "manual", markedBy: OWNER, receipt: R });
	});
	it("null para dono, sem cota e cota só de reembolso", () => {
		expect(payShare(base, OWNER, OWNER, NOW, OWNER)).toBeNull();
		expect(payShare(base, OWNER, "zz", NOW, "zz")).toBeNull();
		expect(payShare([sh(OWNER, 1500), sh("a", 0, 500)], OWNER, "a", NOW, "a", R)).toBeNull();
	});
	it("undoShare descarta o comprovante e é idempotente depois", () => {
		const paid = payShare(base, OWNER, "a", NOW, "a", R)!.shares;
		const undone = undoShare(paid, OWNER, "a")!;
		expect(undone.shares[1]).toEqual(sh("a", 1000, 0));
		expect(droppedReceiptKeys(paid, undone.shares)).toEqual([R.key]);
		expect(undoShare(undone.shares, OWNER, "a")!.changed).toBe(false);
	});
	it("recalcShares mantém receipt e method de quem fica, também como reembolso", () => {
		const paid = payShare(base, OWNER, "a", NOW, "a", R)!.shares;
		const more = recalcShares(paid, OWNER, 3000, [OWNER, "a", "b", "c"]);
		expect(more.find((s) => s.uid === "a")).toMatchObject({ amountCents: 750, paidCents: 1000, method: "self", receipt: R });
		const left = recalcShares(paid, OWNER, 3000, [OWNER, "b"]);
		expect(left.find((s) => s.uid === "a")).toMatchObject({ amountCents: 0, paidCents: 1000, method: "self", receipt: R });
		expect(droppedReceiptKeys(paid, left)).toEqual([]);
		expect(droppedReceiptKeys(paid, settleShare(left, OWNER, "a", NOW, OWNER)!.shares)).toEqual([]); // a devolução não apaga o comprovante do pagamento
	});
	it("normalizeShare não mexe em receipt de cota nova", () => {
		const s = { ...sh("a", 1000, 1000), receipt: R };
		expect(normalizeShare(s)).toBe(s);
		expect(normalizeShare({ uid: "a", amountCents: 1000, status: "paid" } as never)).toEqual({ uid: "a", amountCents: 1000, paidCents: 1000 });
	});
});

describe("payShares (lote)", () => {
	const BATCH = { id: "b1", totalCents: 1500, count: 2 };
	const R = { id: "r1", key: "receipts/batch/b1/r1", name: "pix.png", contentType: "image/png", size: 4 };
	const shares = [sh(OWNER, 1000), sh("a", 1000), sh("b", 500, 200), sh("c", 700, 700, { method: "manual" })];
	it("quita só as cotas pedidas, com mesmo comprovante e lote, e informa quanto faltava", () => {
		const r = payShares(shares, OWNER, ["a", "b"], NOW, "a", R, BATCH);
		expect(r.changed).toBe(true);
		expect(r.outcomes).toEqual([
			{ uid: "a", result: "paid", amountCents: 1000 },
			{ uid: "b", result: "paid", amountCents: 300 },
		]);
		for (const uid of ["a", "b"]) {
			expect(r.shares.find((s) => s.uid === uid)).toMatchObject({ paidCents: shares.find((s) => s.uid === uid)!.amountCents, method: "self", markedBy: "a", paidAt: NOW, receipt: R, batch: BATCH });
		}
		expect(r.shares.find((s) => s.uid === "c")).toBe(shares[3]);
		expect(r.shares[0]).toBe(shares[0]);
	});
	it("sem comprovante grava só o lote; já paga e inexistente não mudam nada", () => {
		const r = payShares(shares, OWNER, ["a", "c", OWNER, "zz"], NOW, "a", undefined, BATCH);
		expect(r.shares.find((s) => s.uid === "a")).toMatchObject({ batch: BATCH });
		expect(r.shares.find((s) => s.uid === "a")).not.toHaveProperty("receipt");
		expect(r.outcomes).toEqual(
			expect.arrayContaining([
				{ uid: "c", result: "already_paid" },
				{ uid: OWNER, result: "not_found" },
				{ uid: "zz", result: "not_found" },
			]),
		);
		const none = payShares(shares, OWNER, ["c"], NOW, "a", R, BATCH);
		expect(none.changed).toBe(false);
		expect(none.shares).toBe(shares);
	});
	it("desfazer remove o lote; trocar o comprovante de uma cota a tira do lote sem mexer nas outras", () => {
		const paid = payShares(shares, OWNER, ["a", "b"], NOW, "a", R, BATCH).shares;
		expect(undoShare(paid, OWNER, "a")!.shares.find((s) => s.uid === "a")).toEqual(sh("a", 1000, 0));
		const other = { ...R, id: "r2", key: "receipts/g/e/r2" };
		const swapped = payShare(paid, OWNER, "a", NOW, "a", other)!.shares;
		expect(swapped.find((s) => s.uid === "a")).toMatchObject({ receipt: other });
		expect(swapped.find((s) => s.uid === "a")).not.toHaveProperty("batch");
		expect(swapped.find((s) => s.uid === "b")).toMatchObject({ receipt: R, batch: BATCH });
		expect(droppedReceiptKeys(paid, swapped)).toEqual([]); // "b" ainda referencia a chave
	});
});

describe("devolução (refund): registro, desfazer, lote e admin", () => {
	const R = { id: "x", key: "receipts/g/e/refund1", name: "devolucao.png", contentType: "image/png", size: 10 };
	const PAY = { id: "p", key: "receipts/g/e/pay1", name: "pagamento.png", contentType: "image/png", size: 10 };
	const start = [sh(OWNER, 500), sh("a", 750, 1000, { paidAt: NOW, method: "self", markedBy: "a", receipt: PAY })];

	it("devolver guarda o registro e deixa o pagamento original (paidAt, method, comprovante) intacto", () => {
		const r = settleShare(start, OWNER, "a", new Date("2026-11-12T12:00:00Z"), "adm", true, R)!;
		expect(r.shares[1]).toMatchObject({
			paidCents: 750,
			paidAt: NOW,
			method: "self",
			receipt: PAY,
			refund: { cents: 250, markedBy: "adm", byAdmin: true, receipt: R },
		});
		expect(shareStatus(r.shares[1], OWNER)).toBe("paid");
		expect(refundCents(r.shares[1], OWNER)).toBe(0);
		expect(droppedReceiptKeys(start, r.shares)).toEqual([]);
	});
	it("devolver sem admin não marca byAdmin; repetir é idempotente", () => {
		const once = settleShare(start, OWNER, "a", NOW, OWNER)!;
		expect(once.shares[1].refund).toEqual({ cents: 250, at: NOW, markedBy: OWNER });
		expect(settleShare(once.shares, OWNER, "a", NOW, OWNER)!.changed).toBe(false);
	});
	it("desfazer a devolução devolve o valor a receber e solta só o comprovante da devolução", () => {
		const done = settleShare(start, OWNER, "a", NOW, OWNER, false, R)!.shares;
		const undone = undoShare(done, OWNER, "a")!;
		expect(undone.shares[1]).toEqual(start[1]);
		expect(shareStatus(undone.shares[1], OWNER)).toBe("refund");
		expect(droppedReceiptKeys(done, undone.shares)).toEqual([R.key]);
	});
	it("quem saiu da divisão: a linha fica (cota 0, nada pago) com a devolução inteira; desfazer volta ao reembolso", () => {
		const left = recalcShares(start, OWNER, 1500, [OWNER]);
		expect(left.find((x) => x.uid === "a")).toMatchObject({ amountCents: 0, paidCents: 1000 });
		const done = settleShare(left, OWNER, "a", NOW, OWNER)!.shares;
		expect(done.find((x) => x.uid === "a")).toMatchObject({ amountCents: 0, paidCents: 0, refund: { cents: 1000 } });
		expect(undoShare(done, OWNER, "a")!.shares.find((x) => x.uid === "a")).toMatchObject({ amountCents: 0, paidCents: 1000 });
	});
	it("mudar o valor da cota apaga o registro de uma devolução antiga (e solta o comprovante dela)", () => {
		const done = settleShare(start, OWNER, "a", NOW, OWNER, false, R)!.shares;
		const same = recalcShares(done, OWNER, 1500, [OWNER, "a"]);
		expect(same.find((x) => x.uid === "a")!.refund).toBeDefined();
		const changed = recalcShares(done, OWNER, 3000, [OWNER, "a"]);
		expect(changed.find((x) => x.uid === "a")).not.toHaveProperty("refund");
		expect(droppedReceiptKeys(done, changed)).toEqual([R.key]);
	});
	it("refundShares: várias devoluções, um comprovante e um lote; não deve / dono / inexistente", () => {
		const shares = [sh(OWNER, 0), sh("a", 100, 400), sh("b", 100, 300), sh("c", 100, 100)];
		const batch = { id: "L", totalCents: 500, count: 2 };
		const r = refundShares(shares, OWNER, ["a", "b", "c", OWNER, "zz"], NOW, OWNER, R, batch);
		expect(r.outcomes).toEqual([
			{ uid: OWNER, result: "not_found" },
			{ uid: "a", result: "refunded", amountCents: 300 },
			{ uid: "b", result: "refunded", amountCents: 200 },
			{ uid: "c", result: "already_refunded" },
			{ uid: "zz", result: "not_found" },
		]);
		expect(r.shares.find((x) => x.uid === "a")).toMatchObject({ paidCents: 100, refund: { cents: 300, receipt: R, batch } });
		expect(r.shares.find((x) => x.uid === "c")).toEqual(shares[3]);
		expect(refundShares(shares, OWNER, ["c"], NOW, OWNER, undefined, batch).changed).toBe(false);
	});
	it("marcar como pago pelo administrador registra markedByAdmin; o dono ou 'já paguei' limpam; desfazer remove", () => {
		const adm = settleShare([sh(OWNER, 100), sh("a", 100)], OWNER, "a", NOW, "adm", true)!.shares;
		expect(adm[1]).toMatchObject({ markedBy: "adm", method: "manual", markedByAdmin: true });
		expect(undoShare(adm, OWNER, "a")!.shares[1]).toEqual(sh("a", 100, 0));
		const partial = [sh(OWNER, 100), sh("a", 200, 100, { markedBy: "adm", method: "manual", markedByAdmin: true, paidAt: NOW })];
		expect(payShare(partial, OWNER, "a", NOW, "a")!.shares[1]).not.toHaveProperty("markedByAdmin");
		expect(settleShare(partial, OWNER, "a", NOW, OWNER)!.shares[1]).not.toHaveProperty("markedByAdmin");
	});
});

describe("devolução parcial e saída da divisão (registro nunca fica velho)", () => {
	const R = { id: "x", key: "receipts/g/e/refund1", name: "dev.png", contentType: "image/png", size: 10 };
	it("pagou 1000, cota cai para 600, 'Devolvi' 400, depois sai da divisão: o registro some e os 600 voltam a ser 'a receber de volta'", () => {
		const start = [sh(OWNER, 500), sh("a", 600, 1000, { paidAt: NOW, method: "self", markedBy: "a" })];
		const refunded = settleShare(start, OWNER, "a", NOW, OWNER, false, R)!.shares;
		expect(refunded[1]).toMatchObject({ paidCents: 600, refund: { cents: 400 } });
		const left = recalcShares(refunded, OWNER, 1500, [OWNER]);
		const a = left.find((x) => x.uid === "a")!;
		expect(a).toMatchObject({ amountCents: 0, paidCents: 600 });
		expect(a).not.toHaveProperty("refund");
		expect(shareStatus(a, OWNER)).toBe("refund");
		expect(refundCents(a, OWNER)).toBe(600);
		expect(droppedReceiptKeys(refunded, left)).toEqual([R.key]); // o comprovante da devolução antiga é solto
		// desfazer não existe mais (nada foi devolvido ainda sobre o novo valor); devolver agora registra os 600
		expect(settleShare(left, OWNER, "a", NOW, OWNER)!.shares.find((x) => x.uid === "a")).toMatchObject({ paidCents: 0, refund: { cents: 600 } });
	});
	it("qualquer mudança de valor da cota apaga o registro (inclusive para 0); mesmo valor mantém", () => {
		const refunded = settleShare([sh(OWNER, 500), sh("a", 600, 1000)], OWNER, "a", NOW, OWNER)!.shares;
		expect(recalcShares(refunded, OWNER, 1200, [OWNER, "a"]).find((x) => x.uid === "a")!.refund).toBeDefined();
		expect(recalcShares(refunded, OWNER, 1800, [OWNER, "a"]).find((x) => x.uid === "a")).not.toHaveProperty("refund");
	});
	it("hasPayments: cota com devolução registrada ou comprovante conta como pagamento, mesmo com paidCents 0", () => {
		const zero = [sh(OWNER, 1500), sh("a", 0, 0, { refund: { cents: 1000, at: NOW, markedBy: OWNER } })];
		expect(hasPayments({ paidBy: OWNER, shares: zero })).toBe(true);
		expect(hasPayments({ paidBy: OWNER, shares: [sh(OWNER, 1000), sh("a", 1000, 0, { receipt: { id: "r", key: "k", name: "n", contentType: "image/png", size: 1 } })] })).toBe(true);
		expect(hasPayments({ paidBy: OWNER, shares: [sh(OWNER, 1000), sh("a", 1000)] })).toBe(false);
	});
	it("refundShares sobre cota pendente nunca a quita: already_refunded e nada muda", () => {
		const r = refundShares([sh(OWNER, 0), sh("a", 100, 40)], OWNER, ["a"], NOW, OWNER, undefined, { id: "L", totalCents: 1, count: 1 });
		expect(r.changed).toBe(false);
		expect(r.outcomes).toEqual([{ uid: "a", result: "already_refunded" }]);
	});
});

describe("linha de quem saiu e já teve tudo devolvido (cota 0, nada pago, com histórico)", () => {
	const R = { id: "x", key: "receipts/g/e/refund1", name: "dev.png", contentType: "image/png", size: 10 };
	const PAY = { id: "p", key: "receipts/g/e/pay1", name: "pag.png", contentType: "image/png", size: 10 };
	const settledLeft = () => {
		const start = [sh(OWNER, 500), sh("a", 750, 1000, { paidAt: NOW, method: "self", markedBy: "a", receipt: PAY })];
		const left = recalcShares(start, OWNER, 1500, [OWNER]);
		return settleShare(left, OWNER, "a", NOW, OWNER, false, R)!.shares; // a: amount 0, paid 0, refund{R}, receipt PAY
	};
	it("A: recalcular de novo sem a pessoa (outra edição) mantém a linha intacta, com os dois comprovantes", () => {
		const settled = settledLeft();
		expect(settled.find((x) => x.uid === "a")).toMatchObject({ amountCents: 0, paidCents: 0, refund: { cents: 1000 }, receipt: PAY });
		const again = recalcShares(settled, OWNER, 2000, [OWNER, "b"]);
		expect(again.find((x) => x.uid === "a")).toEqual(settled.find((x) => x.uid === "a"));
		expect(droppedReceiptKeys(settled, again)).toEqual([]);
	});
	it("A: linha zerada sem histórico (sem devolução nem comprovante) continua sumindo", () => {
		expect(recalcShares([sh(OWNER, 500), sh("z", 0, 0)], OWNER, 1000, [OWNER]).some((x) => x.uid === "z")).toBe(false);
	});
	it("B: ao voltar para a divisão começa limpa (sem paidAt, método, markedBy, comprovante nem devolução) e solta os comprovantes", () => {
		const settled = settledLeft();
		const back = recalcShares(settled, OWNER, 3000, [OWNER, "a"]);
		expect(back.find((x) => x.uid === "a")).toEqual(sh("a", 1500, 0));
		expect(shareStatus(back.find((x) => x.uid === "a")!, OWNER)).toBe("pending");
		expect(droppedReceiptKeys(settled, back).sort()).toEqual([PAY.key, R.key].sort());
	});
});

describe("pagamento rebaixado de cota do modelo antigo, sem data", () => {
	it("o parcial rebaixado fica SEM data (nunca 1970), e a leitura e a invariante aguentam", async () => {
		const { addPayment: add, checkShareInvariant: check, normalizeShare: norm } = await import("./shares");
		// modelo antigo: quitada (sem paidAt); a parte cresceu e recebe novo pagamento parcial
		const legacy = { uid: "a", amountCents: 20000, paidCents: 10000, method: "manual" as const } as import("./shares").ExpenseShare;
		const r = add([legacy], "o", "a", 1000, new Date("2026-11-13T12:00:00Z"), "a", { method: "self", partId: "novo" });
		if (!r || "error" in r) throw new Error("erro");
		const s = r.shares[0];
		expect(s.parts).toHaveLength(2);
		expect(s.parts![0].at).toBeUndefined();
		expect(s.parts![1].at).toBeInstanceOf(Date);
		expect(check(s)).toEqual([]);
		// normalizar (ler do banco) mantém o parcial sem data e sem inventar uma
		const again = norm(JSON.parse(JSON.stringify(s)));
		expect(again.parts![0].at).toBeUndefined();
		expect(JSON.stringify(again.parts)).not.toContain("1970");
	});
});

describe("parcial já gravado com data de 1970", () => {
	it("é lido como sem data (sem gravar nada); data verdadeira continua", async () => {
		const { normalizeShare: norm, checkShareInvariant: check } = await import("./shares");
		const s = {
			uid: "a",
			amountCents: 20000,
			paidCents: 3000,
			parts: [
				{ id: "p1", cents: 1000, at: new Date(0), markedBy: "a", method: "self" as const },
				{ id: "p2", cents: 2000, at: new Date("2026-11-10T12:00:00Z"), markedBy: "a", method: "manual" as const },
			],
		};
		const before = JSON.stringify(s);
		const n = norm(s);
		expect(n.parts![0].at).toBeUndefined();
		expect(n.parts![1].at).toEqual(new Date("2026-11-10T12:00:00Z"));
		expect(check(n)).toEqual([]);
		expect(JSON.stringify(s)).toBe(before); // o original não é alterado
		// vindo do banco como texto
		const fromJson = norm(JSON.parse(JSON.stringify(s)));
		expect(fromJson.parts![0].at).toBeUndefined();
	});
});
