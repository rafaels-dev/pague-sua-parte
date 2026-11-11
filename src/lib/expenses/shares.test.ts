import { describe, expect, it } from "vitest";
import {
	balanceOf,
	dueCents,
	hasPayments,
	orderShares,
	participantUidsOf,
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
	it("quitar reembolso de não participante remove a linha", () => {
		const r = settleShare(base, OWNER, "r", NOW, OWNER)!;
		expect(r.shares.map((s) => s.uid)).toEqual([OWNER, "a"]);
	});
	it("quitar reembolso de quem ainda participa: paidCents iguala a cota", () => {
		const r = settleShare([sh(OWNER, 500), sh("a", 750, 1000, { paidAt: NOW })], OWNER, "a", new Date(), OWNER)!;
		expect(r.shares[1]).toMatchObject({ amountCents: 750, paidCents: 750, markedBy: OWNER, method: "manual" });
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
		expect(balanceOf([E1, E2, E3], "u1")).toEqual({ toReceiveCents: 1000, toPayCents: 1000 });
	});
	it("u2", () => {
		// a pagar: E1 1000 | a receber: E2 refund 300, E3 500
		expect(balanceOf([E1, E2, E3], "u2")).toEqual({ toReceiveCents: 800, toPayCents: 1000 });
	});
	it("u3", () => {
		// a receber: E2 refund 200
		expect(balanceOf([E1, E2, E3], "u3")).toEqual({ toReceiveCents: 200, toPayCents: 0 });
	});
	it("dinheiro se conserva: o que um deve, outro recebe", () => {
		const all = ["u1", "u2", "u3"].map((u) => balanceOf([E1, E2, E3], u));
		expect(all.reduce((a, b) => a + b.toReceiveCents, 0)).toBe(all.reduce((a, b) => a + b.toPayCents, 0));
	});
});
