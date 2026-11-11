import { describe, expect, it } from "vitest";
import { splitEqually } from "./split";

describe("splitEqually", () => {
	it("divisão exata", () => {
		expect(splitEqually(900, ["a", "b", "c"], "a")).toEqual([
			{ uid: "a", amountCents: 300 },
			{ uid: "b", amountCents: 300 },
			{ uid: "c", amountCents: 300 },
		]);
	});
	it("sobra fica com quem pagou, mantendo a ordem", () => {
		expect(splitEqually(1000, ["a", "b", "c"], "b")).toEqual([
			{ uid: "a", amountCents: 333 },
			{ uid: "b", amountCents: 334 },
			{ uid: "c", amountCents: 333 },
		]);
		expect(splitEqually(1001, ["a", "b", "c"], "c").map((s) => s.amountCents)).toEqual([333, 333, 335]);
	});
	it("pagador fora: sobra em 1 centavo para os primeiros", () => {
		expect(splitEqually(1001, ["a", "b", "c"], "x").map((s) => s.amountCents)).toEqual([334, 334, 333]);
	});
	it("um participante recebe tudo", () => {
		expect(splitEqually(777, ["a"], "a")).toEqual([{ uid: "a", amountCents: 777 }]);
		expect(splitEqually(777, ["a"], "x")).toEqual([{ uid: "a", amountCents: 777 }]);
	});
	it("valor igual ao número de participantes dá 1 centavo a cada", () => {
		expect(splitEqually(3, ["a", "b", "c"], "b").map((s) => s.amountCents)).toEqual([1, 1, 1]);
	});
	it("erros", () => {
		expect(() => splitEqually(0, ["a"], "a")).toThrow();
		expect(() => splitEqually(-5, ["a"], "a")).toThrow();
		expect(() => splitEqually(10.5, ["a"], "a")).toThrow();
		expect(() => splitEqually(Number.NaN, ["a"], "a")).toThrow();
		expect(() => splitEqually(100, [], "a")).toThrow();
		expect(() => splitEqually(100, ["a", "a"], "a")).toThrow();
		expect(() => splitEqually(2, ["a", "b", "c"], "a")).toThrow();
	});
	it("propriedades sobre entradas aleatórias", () => {
		let seed = 12345;
		const rnd = (max: number) => {
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return Math.floor((seed / 4294967296) * max);
		};
		for (let iter = 0; iter < 5000; iter++) {
			const n = 1 + rnd(12);
			const uids = Array.from({ length: n }, (_, i) => `u${i}`);
			const amount = n + rnd(2_000_000);
			const payer = rnd(3) === 0 ? "fora" : uids[rnd(n)];
			const shares = splitEqually(amount, uids, payer);
			expect(shares.map((s) => s.uid)).toEqual(uids);
			expect(shares.reduce((a, s) => a + s.amountCents, 0)).toBe(amount);
			expect(shares.every((s) => Number.isInteger(s.amountCents) && s.amountCents > 0)).toBe(true);
			const others = shares.filter((s) => s.uid !== payer).map((s) => s.amountCents);
			if (others.length) expect(Math.max(...others) - Math.min(...others)).toBeLessThanOrEqual(1);
			if (uids.includes(payer)) expect(others.every((c) => c === Math.floor(amount / n))).toBe(true);
		}
	});
});
