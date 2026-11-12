import { splitEqually } from "@/lib/expenses/split";

/** Resposta de uma pessoa do plano. `limitCents` ausente = sem limite. */
export type PlanAnswer = { who: string; going: boolean; limitCents?: number | null };

export type PlanHint = { extraPeople: number; shareCents: number };

export type PlanComputation = {
	peopleCount: number;
	/** Quem disse "Vou", na ordem das pessoas do plano. */
	goingUids: string[];
	/** O maior grupo em que a parte cabe no limite de todos; vazio quando não fecha. */
	fits: boolean;
	includedUids: string[];
	/** A parte de cada um quando fecha; null quando não fecha. */
	shareCents: number | null;
	/** Disseram "Vou" mas ficaram fora da conta (a parte passaria do limite). */
	aboveLimitUids: string[];
	/** Para cada pessoa de `aboveLimitUids`: quanto seria a parte dela se entrasse na conta agora. */
	shareIfIncluded: Record<string, number>;
	/** A parte se todas as pessoas do plano fossem. */
	shareIfAllCents: number | null;
	/** Quantas pessoas a mais (sem limite) fariam fechar (ou baixar a parte), e por quanto. */
	hint: PlanHint | null;
};

/** Quantas pessoas a mais a dica testa, no máximo. */
export const MAX_HINT_PEOPLE = 30;

/**
 * A maior parte ao dividir `totalCents` por `k`: a mesma divisão que a despesa usa (`splitEqually`), sem contar com a sobra
 * extra que vai para quem pagou (na despesa, quem pagou fica com a sobra de até k-1 centavos; os outros pagam no máximo isto). Null quando não dá para dividir (menos de 1 centavo por pessoa).
 */
export function maxShare(totalCents: number, k: number): number | null {
	if (!Number.isInteger(totalCents) || totalCents <= 0 || !Number.isInteger(k) || k < 1 || totalCents < k) return null;
	const ids = Array.from({ length: k }, (_, i) => String(i));
	return Math.max(...splitEqually(totalCents, ids, "").map((s) => s.amountCents));
}

/**
 * Menor número de pessoas (1..`maxPeople`) em que a maior parte da divisão cabe em `limitCents`; null se nem com `maxPeople` cabe.
 * Usa `maxShare` (centavos inteiros, mesma divisão da despesa). Depende só do total e do limite dados.
 */
export function minPeopleForLimit(totalCents: number, limitCents: number, maxPeople: number): number | null {
	for (let k = 1; k <= maxPeople; k++) {
		const share = maxShare(totalCents, k);
		if (share === null) return null;
		if (share <= limitCents) return k;
	}
	return null;
}

/** Com os limites em ordem decrescente: o maior k em que o k-ésimo limite cobre a parte. */
function bestFit(totalCents: number, limitsDesc: number[]): { k: number; share: number } | null {
	for (let k = limitsDesc.length; k >= 1; k--) {
		const share = maxShare(totalCents, k);
		if (share !== null && limitsDesc[k - 1] >= share) return { k, share };
	}
	return null;
}

const limitOf = (a: PlanAnswer) => (typeof a.limitCents === "number" && a.limitCents > 0 ? a.limitCents : Number.POSITIVE_INFINITY);

/**
 * A conta do plano. Divisão sempre em partes iguais; o limite de cada um só decide se a pessoa entra.
 * Respostas de quem não está em `people` são ignoradas (quem saiu do plano).
 */
export function computePlan(totalCents: number, people: string[], answers: PlanAnswer[], opts: { expectedPeople?: number | null } = {}): PlanComputation {
	const inPlan = new Set(people);
	const byWho = new Map<string, PlanAnswer>();
	for (const a of answers) if (inPlan.has(a.who)) byWho.set(a.who, a);
	const going = people.filter((p) => byWho.get(p)?.going === true);
	const limit = (uid: string) => limitOf(byWho.get(uid)!);

	// Ordem decrescente de limite; empate mantém a ordem das pessoas (sort estável).
	const sorted = [...going].sort((a, b) => limit(b) - limit(a));
	const fit = bestFit(totalCents, sorted.map(limit));
	const includedUids = fit ? sorted.slice(0, fit.k) : [];
	const outside = fit ? sorted.slice(fit.k) : [];

	let aboveLimitUids: string[];
	const shareIfIncluded: Record<string, number> = {};
	if (fit) {
		aboveLimitUids = outside;
		const next = maxShare(totalCents, fit.k + 1);
		for (const u of outside) if (next !== null) shareIfIncluded[u] = next;
	} else {
		// Não fecha: o referência é a parte com todos os que disseram "Vou".
		const all = maxShare(totalCents, going.length);
		aboveLimitUids = all === null ? [] : going.filter((u) => limit(u) < all);
		if (all !== null) for (const u of aboveLimitUids) shareIfIncluded[u] = all;
	}

	// Dica: quantas pessoas a mais (sem limite) com quem já disse "Vou" dentro da conta, e por quanto.
	let hint: PlanHint | null = null;
	if (going.length > 0) {
		// Quem ainda pode entrar: quem não respondeu (quem disse "Não vou" não conta) e, se o criador prevê mais gente
		// do que já está no plano, essas pessoas que ainda nem entraram.
		const pending = people.filter((p) => !byWho.has(p)).length;
		const notYetInPlan = Math.max(0, (opts.expectedPeople ?? 0) - people.length);
		const cap = Math.min(MAX_HINT_PEOPLE, pending + notYetInPlan);
		const lowest = Math.min(...going.map(limit));
		for (let m = 1; m <= cap; m++) {
			const share = maxShare(totalCents, going.length + m);
			if (share === null) break;
			if (lowest >= share && (!fit || share < fit.share)) {
				hint = { extraPeople: m, shareCents: share };
				break;
			}
		}
	}

	return {
		peopleCount: people.length,
		goingUids: going,
		fits: !!fit,
		includedUids,
		shareCents: fit ? fit.share : null,
		aboveLimitUids,
		shareIfIncluded,
		shareIfAllCents: maxShare(totalCents, people.length),
		hint,
	};
}
