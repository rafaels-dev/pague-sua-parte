import { computePlan, maxShare } from "./compute";
import { peopleOf, type PlanDoc } from "./collection";

/** O valor previsto da parte de uma pessoa (indicativo para "Até quanto posso pagar"). */
export type SharePreview = {
	cents: number;
	/**
	 * `expected`: total ÷ pessoas previstas pelo criador (`people` = quantas).
	 * `plan`: sem previsão e sem outro "Vou": total ÷ pessoas do plano.
	 * `today`: a parte de hoje se esta pessoa for (há outros que disseram "Vou").
	 */
	basis: "expected" | "plan" | "today";
	people: number;
};

type PreviewPlan = Pick<PlanDoc, "totalCents" | "participants" | "guests" | "responses"> & { expectedPeople?: number };

/**
 * Quanto ficaria a parte de `who` (mesma divisão da conta, `maxShare`):
 * - com `expectedPeople`: total ÷ as pessoas previstas (ou as que já estão no plano, se forem mais);
 * - sem: a parte de hoje se `who` for (conjunto que fecha incluindo `who`, sem limite); se ninguém mais disse "Vou", total ÷ pessoas
 *   do plano (no mínimo 1 pessoa).
 * Só usa o resultado agregado: nenhum limite de ninguém é devolvido, só o valor da parte.
 */
export function sharePreview(plan: PreviewPlan, who: string): SharePreview | null {
	const people = peopleOf(plan);
	const peopleCount = Math.max(1, people.length);
	if (plan.expectedPeople) {
		const n = Math.max(plan.expectedPeople, peopleCount);
		const cents = maxShare(plan.totalCents, n);
		return cents === null ? null : { cents, basis: "expected", people: n };
	}
	const others = plan.responses.filter((r) => r.who !== who && r.going && people.includes(r.who));
	if (others.length === 0) {
		const cents = maxShare(plan.totalCents, peopleCount);
		return cents === null ? null : { cents, basis: "plan", people: peopleCount };
	}
	const answers = [...plan.responses.filter((r) => r.who !== who).map((r) => ({ who: r.who, going: r.going, limitCents: r.limitCents })), { who, going: true }];
	const c = computePlan(plan.totalCents, people, answers);
	return c.shareCents === null ? null : { cents: c.shareCents, basis: "today", people: c.includedUids.length };
}
