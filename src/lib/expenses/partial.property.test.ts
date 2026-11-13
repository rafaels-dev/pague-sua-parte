import { describe, expect, it } from "vitest";
import {
	addHelper,
	addPayment,
	checkShareInvariant,
	latestPayment,
	payShare,
	normalizeShares,
	payShares,
	refundShares,
	receiptKeysOfShare,
	recalcShares,
	selfPayChange,
	settleShare,
	undoShare,
	type ExpenseShare,
	type ShareChange,
	type ShareReceipt,
} from "./shares";

/** PRNG com semente fixa (mulberry32): a sequência é a mesma em toda execução. */
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

const OWNER = "o";
const PEOPLE = ["a", "b", "c", "d"];
const total = (s: ExpenseShare) => s.paidCents + (s.refund?.cents ?? 0);
const keysOf = (shares: ExpenseShare[], uid: string) => new Set(shares.filter((s) => s.uid === uid).flatMap(receiptKeysOfShare));

/** Cotas do modelo antigo (sem `parts`): com e sem metadados, `status` antigo, parcialmente pagas e pagas a mais. */
function legacyShares(rand: () => number, receipt: () => ShareReceipt): ExpenseShare[] {
	const amounts = [2000, 2500, 3000, 1500];
	const raw: unknown[] = PEOPLE.map((uid, i) => {
		const amountCents = amounts[i];
		const kind = Math.floor(rand() * 7);
		const meta = { paidAt: new Date(Date.UTC(2026, 9, 1 + i)), markedBy: rand() < 0.5 ? uid : OWNER, method: rand() < 0.5 ? "self" : "manual" };
		if (kind === 0) return { uid, amountCents, paidCents: 0 };
		if (kind === 1) return { uid, amountCents, paidCents: amountCents, ...meta, receipt: receipt() }; // quitada com metadados
		if (kind === 2) return { uid, amountCents, paidCents: amountCents }; // quitada sem metadados
		if (kind === 3) return { uid, amountCents, status: "paid" }; // status antigo
		if (kind === 4) return { uid, amountCents: amountCents - 500, paidCents: amountCents, ...meta }; // pagou a mais
		if (kind === 5) return { uid, amountCents, paidCents: amountCents, receipt: receipt() }; // só comprovante
		return { uid, amountCents, paidCents: Math.floor(amountCents / 3) }; // parcial sem registro (a parte cresceu)
	});
	return [{ uid: OWNER, amountCents: 1000, paidCents: 0 }, ...normalizeShares(raw as ExpenseShare[])];
}

function run(seed: number, steps: number, legacy = false) {
	const rand = rng(seed);
	const int = (n: number) => Math.floor(rand() * n);
	const pick = <T,>(xs: T[]): T => xs[int(xs.length)];
	let clock = Date.UTC(2026, 10, 1);
	let nr = 0;
	const receipt = (): ShareReceipt => ({ id: `r${++nr}`, key: `receipts/${seed}/${nr}`, name: `r${nr}.png`, contentType: "image/png", size: 4 });
	const maybeReceipt = () => (rand() < 0.6 ? receipt() : undefined);
	const tick = () => {
		const r = rand();
		if (r < 0.6) clock += 1000 * (1 + int(5000));
		else if (r < 0.75) clock -= 1000 * int(100000); // relógio atrasado: datas fora de ordem (a ordem dos pagamentos é a de registro)
		return new Date(clock); // nos demais casos o relógio não anda: empate de datas
	};
	let amount = 6000 + int(9000);
	let shares: ExpenseShare[] = legacy ? legacyShares(rand, receipt) : recalcShares([], OWNER, amount, [OWNER, ...PEOPLE.slice(0, 3)]);
	if (legacy) amount = shares.reduce((t, s) => t + s.amountCents, 0);
	for (const s of shares) {
		const bad = checkShareInvariant(s);
		if (bad.length) throw new Error(`estado inicial legado inválido (seed ${seed}) em ${s.uid}: ${bad.join("; ")}`);
	}
	const log: string[] = [];
	const counts: Record<string, number> = {};
	const applied = (op: string) => (counts[op] = (counts[op] ?? 0) + 1);

	for (let step = 0; step < steps; step++) {
		const before = shares;
		const target = pick(PEOPLE);
		const t = before.find((s) => s.uid === target);
		const now = tick();
		const op = pick(["selfPartial", "selfPartial", "selfFull", "ownerPartial", "ownerSettle", "batch", "refundAll", "undo", "undo", "recalc", "recalc", "help", "attach", "stale"]);
		let after: ExpenseShare[] = before;
		/** Chaves de comprovante que podem sumir neste passo (e de quais cotas). */
		let mayLose: ((uid: string) => Set<string>) | null = null;
		const none = () => new Set<string>();
		const apply = (c: ShareChange | { error: string } | null) => {
			if (c && !("error" in c)) {
				after = c.shares;
				applied(op);
			}
		};
		if (op === "selfPartial" && t) {
			const due = t.amountCents - t.paidCents;
			const cents = due > 0 ? 1 + int(due + 1) : 1 + int(50);
			apply(selfPayChange(before, OWNER, target, now, target, { amountCents: cents, expectedPaidCents: t.paidCents, receipt: maybeReceipt(), partId: `p${step}` }));
		} else if (op === "stale" && t) {
			// pedido com valor esperado errado nunca muda nada
			const r = selfPayChange(before, OWNER, target, now, target, { amountCents: 1, expectedPaidCents: t.paidCents + 1, partId: `s${step}` });
			if (r && !("error" in r)) throw new Error("pedido stale foi aplicado");
		} else if (op === "selfFull") {
			apply(payShare(before, OWNER, target, now, target, maybeReceipt()));
			// numa parte já quitada isto é a troca de comprovante: só o do pagamento mais recente pode sair
			const latest = t ? latestPayment(t) : undefined;
			mayLose = (uid) => (uid === target && t && t.paidCents === t.amountCents && latest?.method === "self" && latest.receipt ? new Set([latest.receipt.key]) : none());
		} else if (op === "ownerPartial" && t) {
			const due = t.amountCents - t.paidCents;
			const cents = due > 0 ? 1 + int(due + 1) : 1;
			apply(addPayment(before, OWNER, target, cents, now, OWNER, { method: "manual", asAdmin: rand() < 0.3, partId: `m${step}`, expectedPaidCents: t.paidCents }));
		} else if (op === "ownerSettle") {
			const rr = rand() < 0.5 ? receipt() : undefined;
			apply(settleShare(before, OWNER, target, now, OWNER, rand() < 0.3, rr, rr ? { id: `b${step}`, totalCents: 1, count: 1 } : undefined));
		} else if (op === "batch") {
			const who = PEOPLE.filter(() => rand() < 0.6);
			const r = payShares(before, OWNER, who, now, "a", maybeReceipt(), { id: `batch${step}`, totalCents: 1, count: who.length });
			if (r.changed) {
				after = r.shares;
				applied(op);
			}
		} else if (op === "refundAll") {
			const who = PEOPLE.filter(() => rand() < 0.6);
			const rr = rand() < 0.5 ? receipt() : undefined;
			const r = refundShares(before, OWNER, who, now, OWNER, rr, { id: `refund${step}`, totalCents: 1, count: who.length });
			if (r.changed) {
				after = r.shares;
				applied(op);
			}
		} else if (op === "undo") {
			const r = undoShare(before, OWNER, target);
			if (r?.changed) {
				after = r.shares;
				applied(op);
				const latest = t && !t.refund ? latestPayment(t) : undefined;
				mayLose = (uid) => (uid === target ? new Set([...(latest?.receipt ? [latest.receipt.key] : []), ...(t?.refund?.receipt ? [t.refund.receipt.key] : [])]) : none());
			}
		} else if (op === "recalc" || op === "help") {
			try {
				if (op === "help") {
					const out = before.filter((s) => s.amountCents === 0).map((s) => s.uid);
					const candidates = PEOPLE.filter((p) => !before.some((s) => s.uid === p && s.amountCents > 0));
					const helper = pick(candidates.length ? candidates : out.length ? out : PEOPLE);
					if (before.some((s) => s.uid === helper && s.amountCents > 0)) continue;
					after = addHelper(before, OWNER, amount, helper, now);
				} else {
					const next = rand() < 0.5 ? amount : 2000 + int(20000);
					const parts = [OWNER, ...PEOPLE.filter(() => rand() < 0.7)];
					after = recalcShares(before, OWNER, next, parts);
					amount = next;
				}
				applied(op);
				// só some comprovante de cota que tinha devolução registrada (o devolvido sai dos pagamentos) ou voltou limpa depois de tudo devolvido
				mayLose = (uid) => {
					const b = before.find((s) => s.uid === uid);
					return b && (b.refund || (b.amountCents === 0 && b.paidCents === 0)) ? keysOf(before, uid) : none();
				};
			} catch {
				continue; // valor pequeno demais para dividir
			}
		} else if (op === "attach" && t) {
			const r = payShare(before, OWNER, target, now, target, receipt());
			if (r?.changed) {
				after = r.shares;
				applied(op);
				const latest = latestPayment(t);
				mayLose = (uid) => (uid === target && latest?.method === "self" && latest.receipt ? new Set([latest.receipt.key]) : none());
			}
		}
		shares = after;
		log.push(`${step}:${op}:${target}`);

		// ---- propriedades depois de cada passo
		const where = `seed ${seed}, passo ${step} (${op} ${target}); últimos: ${log.slice(-6).join(" ")}`;
		for (const s of shares) {
			const bad = checkShareInvariant(s);
			if (bad.length) throw new Error(`invariante quebrada (${where}) em ${s.uid}: ${bad.join("; ")}\n${JSON.stringify(s)}`);
			if (!Number.isInteger(s.paidCents) || s.paidCents < 0) throw new Error(`paidCents inválido (${where})`);
			for (const p of s.parts ?? []) if (!(p.cents > 0) || !Number.isInteger(p.cents)) throw new Error(`parcial inválido (${where})`);
		}
		// total pago só muda como esperado: sem devolução descartada, igual; com devolução descartada, cai exatamente o devolvido
		if (op === "recalc" || op === "help") {
			for (const b of before) {
				const s = shares.find((x) => x.uid === b.uid);
				if (!s) continue;
				const cleanStart = b.amountCents === 0 && b.paidCents === 0;
				if (cleanStart) continue;
				const dropped = b.refund && !s.refund;
				const expected = dropped ? b.paidCents : total(b);
				if (total(s) !== expected) throw new Error(`total pago mudou à toa (${where}) em ${b.uid}: ${total(b)} -> ${total(s)}`);
			}
		}
		// nenhum comprovante some sem que o pagamento dele tenha sido desfeito/devolvido
		for (const s of before) {
			const was = keysOf(before, s.uid);
			const now2 = keysOf(shares, s.uid);
			const allowed = mayLose ? mayLose(s.uid) : new Set<string>();
			for (const k of was) if (!now2.has(k) && !allowed.has(k)) throw new Error(`comprovante ${k} sumiu sem motivo (${where}) em ${s.uid}`);
		}
	}
	return counts;
}

describe("propriedade: a invariante dos pagamentos vale depois de qualquer operação", () => {
	it.each([1, 2, 3, 7, 42, 2026])("semente %i: 3000 passos aleatórios a partir de cotas novas", (seed) => {
		const counts = run(seed, 3000);
		// a sequência realmente exercitou as operações principais
		for (const op of ["selfPartial", "selfFull", "ownerPartial", "ownerSettle", "batch", "refundAll", "undo", "recalc", "help"]) expect(counts[op] ?? 0).toBeGreaterThan(20);
	});
	it.each([11, 12, 13, 14, 15, 16, 17, 18])("semente %i: 3000 passos a partir de cotas do modelo antigo (com e sem paidAt, status antigo, pagas a mais)", (seed) => {
		const counts = run(seed, 3000, true);
		for (const op of ["selfPartial", "selfFull", "ownerPartial", "ownerSettle", "undo", "recalc"]) expect(counts[op] ?? 0).toBeGreaterThan(20);
	});
});
