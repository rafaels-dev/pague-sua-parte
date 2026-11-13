import { describe, expect, it } from "vitest";
import { checkShareInvariant, dueCents, type ExpenseShare } from "@/lib/expenses/shares";
import {
	advanceDoneClause,
	advancePreview,
	applyAdvanceSlice,
	buildAdvanceShareText,
	distributeAdvance,
	numbersLabel,
	undoAdvanceSlice,
	totalDue,
	type AdvanceItem,
	type AdvanceSummaryItem,
} from "./advance";

/** PRNG com semente fixa (mulberry32). */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const items = (...due: number[]): AdvanceItem[] => due.map((d, k) => ({ id: `e${k + 1}`, number: k + 1, dueCents: d }));
const summary = (r: ReturnType<typeof distributeAdvance>): AdvanceSummaryItem[] =>
	r.ok ? r.allocations.map((a) => ({ number: a.number, cents: a.cents, settled: a.settles, remainingCents: a.remainingCents })) : [];

describe("distributeAdvance", () => {
	it("exemplo do dono: 10 parcelas de R$ 100 e R$ 347 quitam 1, 2 e 3 e põem R$ 47 na 4", () => {
		const r = distributeAdvance(items(...Array(10).fill(10000)), 34700);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.allocations.map((a) => [a.number, a.cents, a.settles, a.remainingCents])).toEqual([
			[1, 10000, true, 0],
			[2, 10000, true, 0],
			[3, 10000, true, 0],
			[4, 4700, false, 5300],
		]);
		expect(r.totalDueCents).toBe(100000);
	});

	it("valor exato de parcelas inteiras não deixa pedaço", () => {
		const r = distributeAdvance(items(10000, 10000, 10000), 20000);
		expect(summary(r).every((s) => s.settled)).toBe(true);
		expect(summary(r).map((s) => s.number)).toEqual([1, 2]);
	});

	it("1 centavo vai para a primeira parcela", () => {
		const r = distributeAdvance(items(10000, 10000), 1);
		expect(summary(r)).toEqual([{ number: 1, cents: 1, settled: false, remainingCents: 9999 }]);
	});

	it("tudo que falta quita a série inteira", () => {
		const r = distributeAdvance(items(500, 700, 900), 2100);
		expect(summary(r).map((s) => s.settled)).toEqual([true, true, true]);
	});

	it("parcelas com valores diferentes (cashback)", () => {
		const r = distributeAdvance(items(9000, 9500, 9500, 9500), 20000);
		expect(summary(r)).toEqual([
			{ number: 1, cents: 9000, settled: true, remainingCents: 0 },
			{ number: 2, cents: 9500, settled: true, remainingCents: 0 },
			{ number: 3, cents: 1500, settled: false, remainingCents: 8000 },
		]);
	});

	it("pula parcelas já quitadas, parcialmente pagas e aquelas em que a pessoa não participa", () => {
		// 1 quitada, 2 já paga em parte (faltam 40), 3 sem participação, 4 inteira
		const r = distributeAdvance(items(0, 4000, 0, 10000), 6000);
		expect(summary(r)).toEqual([
			{ number: 2, cents: 4000, settled: true, remainingCents: 0 },
			{ number: 4, cents: 2000, settled: false, remainingCents: 8000 },
		]);
	});

	it("ordena pelo número da parcela, não pela ordem recebida", () => {
		const shuffled: AdvanceItem[] = [
			{ id: "c", number: 3, dueCents: 100 },
			{ id: "a", number: 1, dueCents: 100 },
			{ id: "b", number: 2, dueCents: 100 },
		];
		const r = distributeAdvance(shuffled, 150);
		expect(r.ok && r.allocations.map((a) => a.id)).toEqual(["a", "b"]);
	});

	it("recusa valor inválido ou maior que o total (nunca vira devolução)", () => {
		for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
			const r = distributeAdvance(items(1000, 1000), bad);
			expect(r.ok).toBe(false);
		}
		expect(distributeAdvance(items(1000, 1000), 2001)).toMatchObject({ ok: false, error: "too_much", totalDueCents: 2000 });
		expect(distributeAdvance(items(1000), 0)).toMatchObject({ ok: false, error: "invalid" });
		expect(distributeAdvance([], 100)).toMatchObject({ ok: false, error: "too_much", totalDueCents: 0 });
	});

	it("totalDue ignora o que não falta", () => {
		expect(totalDue(items(0, 100, -5, 200))).toBe(300);
	});

	it("propriedade (semente fixa): soma exata, nunca passa do que falta, ordem respeitada, só a última pode ficar parcial", () => {
		const rand = rng(20261113);
		for (let n = 0; n < 2000; n++) {
			const count = 1 + Math.floor(rand() * 12);
			const list: AdvanceItem[] = Array.from({ length: count }, (_, k) => ({
				id: `e${k}`,
				number: k + 1,
				dueCents: rand() < 0.25 ? 0 : 1 + Math.floor(rand() * 50000),
			}));
			const total = totalDue(list);
			if (total === 0) continue;
			const amount = 1 + Math.floor(rand() * total);
			const r = distributeAdvance(list, amount);
			expect(r.ok).toBe(true);
			if (!r.ok) continue;
			expect(r.allocations.reduce((t, a) => t + a.cents, 0)).toBe(amount);
			const byId = new Map(list.map((i) => [i.id, i]));
			let lastNumber = 0;
			r.allocations.forEach((a, k) => {
				const it = byId.get(a.id)!;
				expect(Number.isSafeInteger(a.cents) && a.cents >= 1).toBe(true);
				expect(a.cents).toBeLessThanOrEqual(it.dueCents);
				expect(a.remainingCents).toBe(it.dueCents - a.cents);
				expect(a.settles).toBe(a.cents === it.dueCents);
				expect(a.number).toBeGreaterThan(lastNumber);
				lastNumber = a.number;
				// só a última parcela tocada pode ficar em aberto
				if (k < r.allocations.length - 1) expect(a.settles).toBe(true);
			});
			// nenhuma parcela com algo a pagar e número menor que o da última tocada ficou de fora
			const touched = new Set(r.allocations.map((a) => a.id));
			for (const i of list) if (i.dueCents > 0 && i.number < lastNumber) expect(touched.has(i.id)).toBe(true);
		}
	});
});

describe("textos", () => {
	it("numbersLabel", () => {
		expect(numbersLabel([1])).toBe("1");
		expect(numbersLabel([1, 2])).toBe("1 e 2");
		expect(numbersLabel([1, 2, 3])).toBe("1 a 3");
		expect(numbersLabel([1, 2, 3], false)).toBe("1, 2 e 3");
		expect(numbersLabel([1, 3, 4])).toBe("1, 3 e 4");
		expect(numbersLabel([1, 2, 3, 4, 5], false)).toBe("1 a 5");
	});

	it("prévia do exemplo do dono", () => {
		const r = distributeAdvance(items(...Array(10).fill(10000)), 34700);
		expect(advancePreview(summary(r))).toBe("Paga as parcelas 1, 2 e 3 e R$ 47,00 da parcela 4. Na parcela 4 ficam faltando R$ 53,00.");
	});

	it("prévia só com parcelas quitadas e só com pedaço", () => {
		expect(advancePreview(summary(distributeAdvance(items(1000, 1000), 1000)))).toBe("Paga a parcela 1.");
		expect(advancePreview(summary(distributeAdvance(items(1000, 1000), 2000)))).toBe("Paga as parcelas 1 e 2.");
		expect(advancePreview(summary(distributeAdvance(items(10000), 4700)))).toBe("Paga R$ 47,00 da parcela 1. Na parcela 1 ficam faltando R$ 53,00.");
		expect(advancePreview([])).toBe("");
	});

	it("frase de depois de gravar e texto do WhatsApp (sem chave Pix)", () => {
		const s = summary(distributeAdvance(items(...Array(10).fill(10000)), 34700));
		expect(advanceDoneClause(s)).toBe("parcelas 1 a 3 pagas e R$ 47,00 da parcela 4");
		const text = buildAdvanceShareText({ totalCents: 34700, description: "Sofá.", items: s, hasReceipt: false }, "https://x.test/app/grupos/g/despesas/e");
		expect(text).toBe("Adiantei R$ 347,00 de Sofá: as parcelas 1 a 3 e parte da 4. Confira aqui: https://x.test/app/grupos/g/despesas/e");
		const one = buildAdvanceShareText({ totalCents: 3000, description: "TV", forName: "Ben", items: summary(distributeAdvance(items(10000), 3000)), hasReceipt: true }, "L");
		expect(one).toBe("Adiantei R$ 30,00 da parte de Ben na despesa TV: parte da parcela 1. Veja o comprovante: L");
		expect(text).not.toMatch(/pix/i);
	});
});

const BATCH = { id: "lote1", totalCents: 14700, count: 2 };
const RECEIPT = { id: "r1", key: "receipts/batch/lote1/r1", name: "c.pdf", contentType: "application/pdf", size: 10 };
const share = (amountCents: number, paidCents = 0): ExpenseShare => ({ uid: "a", amountCents, paidCents });
const now = new Date("2026-11-13T12:00:00Z");
type O = { method: "self" | "manual"; asAdmin?: boolean; receipt?: typeof RECEIPT; batch: typeof BATCH; partId: string; expectedPaidCents: number; expectedDueCents?: number };
/** Aplica uma fatia; `expectedDueCents` padrão = o que falta de verdade na parte. */
const ap = (shares: ExpenseShare[], cents: number, actor: string, o: O) => {
	const s = shares.find((x) => x.uid === "a");
	return applyAdvanceSlice(shares, "o", "a", cents, now, actor, { ...o, expectedDueCents: o.expectedDueCents ?? (s ? dueCents(s, "o") : 0) });
};

describe("applyAdvanceSlice / undoAdvanceSlice", () => {
	it("quitação leva lote e comprovante (self) e mantém a invariante", () => {
		const r = ap([share(10000)], 10000, "a", { method: "self", receipt: RECEIPT, batch: BATCH, partId: "p1", expectedPaidCents: 0 });
		if ("error" in r) throw new Error("erro");
		const s = r.shares[0];
		expect(s).toMatchObject({ paidCents: 10000, batch: BATCH, receipt: RECEIPT });
		expect(checkShareInvariant(s)).toEqual([]);
	});

	it("quitação manual (recebi) também grava o comprovante e o lote", () => {
		const r = ap([share(10000)], 10000, "o", { method: "manual", asAdmin: true, receipt: RECEIPT, batch: BATCH, partId: "p1", expectedPaidCents: 0 });
		if ("error" in r) throw new Error("erro");
		expect(r.shares[0]).toMatchObject({ method: "manual", markedByAdmin: true, batch: BATCH, receipt: RECEIPT });
		expect(checkShareInvariant(r.shares[0])).toEqual([]);
	});

	it("pedaço vira pagamento parcial com lote e comprovante; a parte segue em aberto", () => {
		const r = ap([share(10000)], 4700, "a", { method: "self", receipt: RECEIPT, batch: BATCH, partId: "p1", expectedPaidCents: 0 });
		if ("error" in r) throw new Error("erro");
		const s = r.shares[0];
		expect(dueCents(s, "o")).toBe(5300);
		expect(s.parts![0]).toMatchObject({ cents: 4700, batch: BATCH, receipt: RECEIPT, method: "self" });
		expect(checkShareInvariant(s)).toEqual([]);
	});

	it("recusa 'stale' se a parte já tinha mudado, se a DIVISÃO mudou no meio (parte de R$ 100 virou R$ 120) e valor acima do que falta", () => {
		const o = { method: "self" as const, batch: BATCH, partId: "p1" };
		expect(ap([share(10000, 1000)], 100, "a", { ...o, expectedPaidCents: 0 })).toEqual({ error: "stale" });
		expect(ap([share(12000)], 10000, "a", { ...o, expectedPaidCents: 0, expectedDueCents: 10000 })).toEqual({ error: "stale" });
		expect(ap([share(10000)], 10001, "a", { ...o, expectedPaidCents: 0 })).toEqual({ error: "too_much" });
		expect(applyAdvanceSlice([share(10000)], "o", "x", 100, now, "a", { ...o, expectedPaidCents: 0, expectedDueCents: 0 })).toEqual({ error: "no_share" });
	});

	it("undoAdvanceSlice volta a parte ao que era, nos dois formatos, sem tocar no que veio antes", () => {
		const base = share(10000, 2000);
		base.parts = [{ id: "old", cents: 2000, at: now, markedBy: "a", method: "self" }];
		const part = ap([base], 3000, "a", { method: "self", batch: BATCH, partId: "p2", expectedPaidCents: 2000 });
		if ("error" in part) throw new Error("erro");
		expect(undoAdvanceSlice(part.shares, "o", "a", BATCH.id)).toEqual({ shares: [base] });
		const full = ap([base], 8000, "a", { method: "self", batch: BATCH, partId: "p3", expectedPaidCents: 2000, receipt: RECEIPT });
		if ("error" in full) throw new Error("erro");
		const back = undoAdvanceSlice(full.shares, "o", "a", BATCH.id) as { shares: ExpenseShare[] };
		expect(back.shares[0]).toMatchObject({ paidCents: 2000, parts: base.parts });
		expect(back.shares[0].batch).toBeUndefined();
		expect(checkShareInvariant(back.shares[0])).toEqual([]);
		expect(undoAdvanceSlice([base], "o", "a", BATCH.id)).toBeNull();
	});

	it("undoAdvanceSlice não mexe quando a parte mudou de um jeito inseguro (devolução ou pagamento depois) e avisa", () => {
		const part = ap([share(10000)], 4000, "a", { method: "self", batch: BATCH, partId: "p1", expectedPaidCents: 0 });
		if ("error" in part) throw new Error("erro");
		// outro pagamento entrou depois do adiantamento
		const later = ap(part.shares, 1000, "a", { method: "self", batch: { id: "outro", totalCents: 1000, count: 1 }, partId: "p2", expectedPaidCents: 4000 });
		if ("error" in later) throw new Error("erro");
		expect(undoAdvanceSlice(later.shares, "o", "a", BATCH.id)).toEqual({ unsafe: true });
		// a divisão diminuiu e a parte ganhou devolução
		const full = ap([share(10000)], 10000, "a", { method: "self", batch: BATCH, partId: "p3", expectedPaidCents: 0 });
		if ("error" in full) throw new Error("erro");
		const refunded: ExpenseShare[] = [{ ...full.shares[0], refund: { cents: 2000, at: now, markedBy: "o" } }];
		expect(undoAdvanceSlice(refunded, "o", "a", BATCH.id)).toEqual({ unsafe: true });
	});

	it("propriedade (semente fixa): aplicar a compra toda e desfazer pelo lote mantém a invariante a cada passo", () => {
		const rand = rng(77);
		for (let n = 0; n < 500; n++) {
			const count = 1 + Math.floor(rand() * 8);
			let docs = Array.from({ length: count }, (_, k) => ({ id: `e${k}`, number: k + 1, shares: [share(1000 + Math.floor(rand() * 9000), 0)] }));
			docs = docs.map((d) => {
				if (rand() < 0.4) {
					const first = 1 + Math.floor(rand() * (d.shares[0].amountCents - 1));
					const r = ap(d.shares, first, "a", { method: "self", batch: { id: "ant", totalCents: first, count: 1 }, partId: `q${d.id}`, expectedPaidCents: 0 });
					return "error" in r ? d : { ...d, shares: r.shares };
				}
				return d;
			});
			const dues = docs.map((d) => ({ id: d.id, number: d.number, dueCents: dueCents(d.shares[0], "o") }));
			const total = totalDue(dues);
			if (total === 0) continue;
			const amount = 1 + Math.floor(rand() * total);
			const dist = distributeAdvance(dues, amount);
			if (!dist.ok) throw new Error("distribuição falhou");
			let paidNow = 0;
			for (const a of dist.allocations) {
				const d = docs.find((x) => x.id === a.id)!;
				const r = ap(d.shares, a.cents, "a", { method: rand() < 0.5 ? "self" : "manual", batch: { id: "novo", totalCents: amount, count: dist.allocations.length }, partId: `n${a.id}`, expectedPaidCents: d.shares[0].paidCents });
				if ("error" in r) throw new Error(`erro ${r.error}`);
				expect(checkShareInvariant(r.shares[0])).toEqual([]);
				paidNow += r.shares[0].paidCents - d.shares[0].paidCents;
				const back = undoAdvanceSlice(r.shares, "o", "a", "novo");
				if (!back || "unsafe" in back) throw new Error("desfazer inseguro");
				expect(back.shares[0].paidCents).toBe(d.shares[0].paidCents);
				expect(checkShareInvariant(back.shares[0])).toEqual([]);
			}
			expect(paidNow).toBe(amount);
		}
	});
});
