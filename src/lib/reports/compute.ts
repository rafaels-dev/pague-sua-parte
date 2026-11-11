import { isHelper, normalizeShares, type ExpenseShare } from "@/lib/expenses/shares";

/**
 * Contas do relatório de contribuições. A referência em JS (`referenceFacet`) e a agregação do MongoDB
 * (`reportPipeline`) fazem exatamente a mesma conta, por despesa:
 *
 *  - dono (`paidBy`): adiantou o valor todo; `born` = valor − Σ min(pago, valor) das cotas dos outros;
 *  - cada outra cota: `born` = min(pago, valor da despesa); `pending` = max(0, cota − pago);
 *    `owedBack` = max(0, pago − cota); `share` = cota.
 *
 * IDENTIDADE (vale sempre, com ou sem reembolsos pendentes): por despesa, Σ born de todas as pessoas = valor da
 * despesa; logo Σ bornCents === totalCents. O dono "perde" só o que os outros ainda não repuseram, e quem pagou a
 * mais que a cota (reembolso pendente) já está com esse dinheiro fora do bolso, contado em `born`.
 * Como as cotas somam o valor (Σ share = valor), vale também, por despesa e sem contar o teto `min(…, valor)`:
 *   born(dono) = share(dono) + Σ pending − Σ owedBack     e     born(outro) = share − pending + owedBack.
 * O `min(…, valor)` só protege de dado corrompido (pago acima do total).
 */
export type ExpenseLike = { paidBy: string; amountCents: number; date: string; shares: ExpenseShare[] };

export type PersonRow = {
	_id: string;
	advanced: number;
	share: number;
	born: number;
	pending: number;
	owedBack: number;
	helped: number;
	paidCount: number;
};
export type Facet = {
	people: PersonRow[];
	months: { _id: string; total: number }[];
	totals: { _id: null; count: number; total: number }[];
};

/** Referência em JS, no mesmo formato do `$facet` do MongoDB (ordem das linhas não importa). */
export function referenceFacet(expenses: ExpenseLike[]): Facet {
	const people = new Map<string, PersonRow>();
	const row = (uid: string) => {
		let r = people.get(uid);
		if (!r) people.set(uid, (r = { _id: uid, advanced: 0, share: 0, born: 0, pending: 0, owedBack: 0, helped: 0, paidCount: 0 }));
		return r;
	};
	const months = new Map<string, number>();
	let total = 0;
	for (const e of expenses) {
		total += e.amountCents;
		months.set(e.date.slice(0, 7), (months.get(e.date.slice(0, 7)) ?? 0) + e.amountCents);
		const shares = normalizeShares(e.shares);
		const owner = row(e.paidBy);
		owner.advanced += e.amountCents;
		owner.paidCount += 1;
		let othersBorn = 0;
		for (const s of shares) {
			if (s.uid === e.paidBy) {
				owner.share += s.amountCents;
				continue;
			}
			const r = row(s.uid);
			const born = Math.min(s.paidCents, e.amountCents);
			othersBorn += born;
			r.share += s.amountCents;
			r.born += born;
			r.pending += Math.max(0, s.amountCents - s.paidCents);
			r.owedBack += Math.max(0, s.paidCents - s.amountCents);
			r.helped += isHelper(s) ? 1 : 0;
		}
		owner.born += e.amountCents - othersBorn;
	}
	return {
		people: [...people.values()],
		months: [...months].map(([_id, t]) => ({ _id, total: t })).sort((a, b) => a._id.localeCompare(b._id)),
		totals: expenses.length ? [{ _id: null, count: expenses.length, total }] : [],
	};
}

// ---------- agregação do MongoDB (uma só) ----------

/** paidCents lendo o modelo antigo (`status: 'paid'` vale a cota inteira). */
const paidOf = (v: string) => ({
	$cond: [{ $isNumber: `${v}.paidCents` }, `${v}.paidCents`, { $cond: [{ $eq: [`${v}.status`, "paid"] }, `${v}.amountCents`, 0] }],
});

export function reportPipeline(match: Record<string, unknown>) {
	const others = {
		$filter: { input: "$shares", as: "s", cond: { $ne: ["$$s.uid", "$paidBy"] } },
	};
	const paid = paidOf("$$s");
	return [
		{ $match: match },
		{
			$addFields: {
				_others: {
					$map: {
						input: others,
						as: "s",
						in: {
							uid: "$$s.uid",
							advanced: { $literal: 0 },
							share: "$$s.amountCents",
							born: { $min: [paid, "$amountCents"] },
							pending: { $max: [0, { $subtract: ["$$s.amountCents", paid] }] },
							owedBack: { $max: [0, { $subtract: [paid, "$$s.amountCents"] }] },
							helped: { $cond: [{ $and: [{ $eq: ["$$s.helped", true] }, { $gt: ["$$s.amountCents", 0] }] }, 1, 0] },
							paidCount: { $literal: 0 },
						},
					},
				},
			},
		},
		{
			$addFields: {
				_rows: {
					$concatArrays: [
						[
							{
								uid: "$paidBy",
								advanced: "$amountCents",
								share: {
									$sum: {
										$map: {
											input: { $filter: { input: "$shares", as: "s", cond: { $eq: ["$$s.uid", "$paidBy"] } } },
											as: "s",
											in: "$$s.amountCents",
										},
									},
								},
								born: { $subtract: ["$amountCents", { $sum: "$_others.born" }] },
								pending: { $literal: 0 },
								owedBack: { $literal: 0 },
								helped: { $literal: 0 },
								paidCount: { $literal: 1 },
							},
						],
						"$_others",
					],
				},
			},
		},
		{
			$facet: {
				people: [
					{ $unwind: "$_rows" },
					{
						$group: {
							_id: "$_rows.uid",
							advanced: { $sum: "$_rows.advanced" },
							share: { $sum: "$_rows.share" },
							born: { $sum: "$_rows.born" },
							pending: { $sum: "$_rows.pending" },
							owedBack: { $sum: "$_rows.owedBack" },
							helped: { $sum: "$_rows.helped" },
							paidCount: { $sum: "$_rows.paidCount" },
						},
					},
				],
				months: [{ $group: { _id: { $substrBytes: ["$date", 0, 7] }, total: { $sum: "$amountCents" } } }, { $sort: { _id: 1 } }],
				totals: [{ $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$amountCents" } } }],
			},
		},
	];
}

// ---------- justiça ----------

/**
 * 100 × (1 − Σ|born_i − equalShare| / (2 × total)), sobre as pessoas do grupo AGORA (`borns`), limitado a 0..100 e
 * arredondado. 100 quando não há gasto. Uma pessoa levando tudo entre 4 → 25; todas iguais → 100.
 */
export function fairnessPercent(borns: number[], equalShareCents: number, totalCents: number): number {
	if (totalCents <= 0) return 100;
	const gap = borns.reduce((t, b) => t + Math.abs(b - equalShareCents), 0);
	return Math.min(100, Math.max(0, Math.round(100 * (1 - gap / (2 * totalCents)))));
}
