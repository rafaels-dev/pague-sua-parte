import { formatBRL } from "@/lib/money";
import {
	addPayment,
	dueCents,
	latestPayment,
	undoShare,
	type ExpenseShare,
	type PartError,
	type ShareBatch,
	type ShareMethod,
	type ShareReceipt,
} from "@/lib/expenses/shares";

/**
 * "Adiantar parcelas": uma pessoa paga (ou quem recebe registra) um valor que abate das parcelas de uma compra parcelada, na
 * ordem em que elas acontecem. Esta é a conta (pura, sem banco nem tela): o servidor a usa para gravar e a tela para a prévia,
 * então os dois sempre dizem a mesma coisa. Dinheiro sempre em centavos inteiros.
 */

/** O que falta da pessoa numa parcela da série. */
export type AdvanceItem = { id: string; number: number; dueCents: number };

export type AdvanceAllocation = {
	id: string;
	number: number;
	/** Quanto deste adiantamento entra nesta parcela (>= 1, nunca mais do que faltava). */
	cents: number;
	/** A parcela fica quitada. */
	settles: boolean;
	/** Quanto ainda falta na parcela depois do adiantamento (0 quando quita). */
	remainingCents: number;
};

export type DistributeError = "invalid" | "too_much";

export type DistributeResult =
	| { ok: true; allocations: AdvanceAllocation[]; /** Soma do que falta nas parcelas (antes do adiantamento). */ totalDueCents: number }
	| { ok: false; error: DistributeError; totalDueCents: number };

/** Textos de erro do adiantamento: um lugar só, usados pela rota e pela tela. */
export const ADVANCE_UNCERTAIN = "Parte do pagamento pode ter sido registrada. Atualize a tela e confira antes de pagar de novo.";
export const ADVANCE_CONFLICT = "Essa compra acabou de ser alterada. Tente de novo.";
export const ADVANCE_TOO_MUCH = "Esse valor é maior do que falta pagar na compra. Atualize e tente de novo.";
export const ADVANCE_RECIPIENT_CHANGED = "A chave Pix de quem recebe mudou. Volte e confira de novo.";

/** Soma do que falta na série (parcelas sem nada a pagar não contam). */
export const totalDue = (items: readonly AdvanceItem[]): number => items.reduce((t, i) => t + (i.dueCents > 0 ? i.dueCents : 0), 0);

/**
 * Reparte `amountCents` pelas parcelas em ordem de número: cada parcela recebe até o que falta nela e só passa para a seguinte
 * quando a anterior está quitada; o resto vira pagamento parcial da primeira que não fecha. Garantias: a soma repartida é
 * exatamente o valor; nenhuma parcela recebe mais do que falta; nenhuma recebe antes de a anterior (com algo a pagar) estar
 * quitada; valor menor que 1, não inteiro ou maior que o total que falta é recusado (adiantar nunca gera devolução).
 * Parcelas sem nada a pagar (já quitadas, ou em que a pessoa não participa) são puladas.
 */
export function distributeAdvance(items: readonly AdvanceItem[], amountCents: number): DistributeResult {
	const open = items
		.filter((i) => Number.isSafeInteger(i.dueCents) && i.dueCents > 0)
		.map((i, order) => ({ i, order }))
		.sort((a, b) => a.i.number - b.i.number || a.order - b.order)
		.map((x) => x.i);
	const totalDueCents = open.reduce((t, i) => t + i.dueCents, 0);
	if (!Number.isSafeInteger(amountCents) || amountCents < 1) return { ok: false, error: "invalid", totalDueCents };
	if (amountCents > totalDueCents) return { ok: false, error: "too_much", totalDueCents };
	const allocations: AdvanceAllocation[] = [];
	let left = amountCents;
	for (const i of open) {
		if (left <= 0) break;
		const cents = Math.min(left, i.dueCents);
		allocations.push({ id: i.id, number: i.number, cents, settles: cents === i.dueCents, remainingCents: i.dueCents - cents });
		left -= cents;
	}
	return { ok: true, allocations, totalDueCents };
}

// ---------- textos (os mesmos na prévia da tela, no aviso e no WhatsApp) ----------

/**
 * "1, 2 e 3" (ou "1 a 3", com `range`, quando são 3 ou mais seguidas). `range: false` ainda abrevia listas longas (5 ou mais seguidas)
 * para a frase não ficar enorme.
 */
export function numbersLabel(numbers: readonly number[], range = true): string {
	const n = [...numbers];
	if (n.length === 0) return "";
	const consecutive = n.every((x, k) => k === 0 || x === n[k - 1] + 1);
	if (consecutive && n.length >= (range ? 3 : 5)) return `${n[0]} a ${n[n.length - 1]}`;
	if (n.length === 1) return String(n[0]);
	return `${n.slice(0, -1).join(", ")} e ${n[n.length - 1]}`;
}

export type AdvanceSummaryItem = { number: number; cents: number; settled: boolean; remainingCents: number };

const split = (items: readonly AdvanceSummaryItem[]) => ({
	full: items.filter((i) => i.settled),
	part: items.find((i) => !i.settled),
});

/**
 * A frase da prévia: "Paga as parcelas 1, 2 e 3 e R$ 47,00 da parcela 4. Na parcela 4 ficam faltando R$ 53,00."
 * (só quitadas: "Paga as parcelas 1 e 2."; só um pedaço: "Paga R$ 47,00 da parcela 4. Na parcela 4 ficam faltando R$ 53,00.").
 */
export function advancePreview(items: readonly AdvanceSummaryItem[]): string {
	const { full, part } = split(items);
	if (items.length === 0) return "";
	const nums = full.map((i) => i.number);
	const quitadas = nums.length === 0 ? "" : `${nums.length === 1 ? "a parcela" : "as parcelas"} ${numbersLabel(nums, false)}`;
	const pedaco = part ? `${formatBRL(part.cents)} da parcela ${part.number}` : "";
	const falta = part ? ` Na parcela ${part.number} ficam faltando ${formatBRL(part.remainingCents)}.` : "";
	return `Paga ${[quitadas, pedaco].filter(Boolean).join(" e ")}.${falta}`;
}

/** Depois de gravado (aviso e mensagem na tela): "parcelas 1 a 3 pagas e R$ 47,00 da parcela 4". */
export function advanceDoneClause(items: readonly AdvanceSummaryItem[]): string {
	const { full, part } = split(items);
	const nums = full.map((i) => i.number);
	const quitadas = nums.length === 0 ? "" : `${nums.length === 1 ? "parcela" : "parcelas"} ${numbersLabel(nums)} ${nums.length === 1 ? "paga" : "pagas"}`;
	const pedaco = part ? `${formatBRL(part.cents)} da parcela ${part.number}` : "";
	return [quitadas, pedaco].filter(Boolean).join(" e ");
}

/** Texto do WhatsApp (sem chave Pix): "Adiantei R$ 347,00 de X: parcelas 1 a 3 e parte da 4." */
export function buildAdvanceShareText(
	p: { totalCents: number; description: string; forName?: string | null; items: readonly AdvanceSummaryItem[]; hasReceipt: boolean },
	link: string,
): string {
	const description = p.description.trim().replace(/[\s.]+$/, "");
	const { full, part } = split(p.items);
	const nums = full.map((i) => i.number);
	const quitadas = nums.length === 0 ? "" : `${nums.length === 1 ? "a parcela" : "as parcelas"} ${numbersLabel(nums)}`;
	const pedaco = part ? (nums.length === 0 ? `parte da parcela ${part.number}` : `parte da ${part.number}`) : "";
	const what = [quitadas, pedaco].filter(Boolean).join(" e ");
	const see = p.hasReceipt ? "Veja o comprovante:" : "Confira aqui:";
	const head = p.forName ? `Adiantei ${formatBRL(p.totalCents)} da parte de ${p.forName} na despesa ${description}` : `Adiantei ${formatBRL(p.totalCents)} de ${description}`;
	return `${head}: ${what}. ${see} ${link}`;
}

// ---------- aplicar numa parte ----------

export type ApplyAdvanceError = PartError | "no_share";

/**
 * Registra a fatia `cents` do adiantamento na parte de `targetUid`: o mesmo caminho dos pagamentos de sempre (`addPayment`, que
 * mantém a invariante dos pagamentos), com o MESMO lote e o MESMO comprovante em todas as parcelas tocadas. `expectedPaidCents` =
 * quanto a parte tinha pago quando o servidor calculou a conta; se mudou, "stale" (nada é gravado).
 */
export function applyAdvanceSlice(
	shares: ExpenseShare[],
	paidBy: string,
	targetUid: string,
	cents: number,
	now: Date,
	actorUid: string,
	o: { method: ShareMethod; asAdmin?: boolean; receipt?: ShareReceipt; batch: ShareBatch; partId: string; expectedPaidCents: number; /** O que o plano calculou que faltava nesta parte (se a divisão mudou no meio, "stale"). */ expectedDueCents: number },
): { shares: ExpenseShare[]; changed: boolean } | { error: ApplyAdvanceError } {
	const target = shares.find((s) => s.uid === targetUid);
	if (target && dueCents(target, paidBy) !== o.expectedDueCents) return { error: "stale" };
	const change = addPayment(shares, paidBy, targetUid, cents, now, actorUid, {
		method: o.method,
		asAdmin: o.asAdmin,
		receipt: o.receipt,
		partId: o.partId,
		expectedPaidCents: o.expectedPaidCents,
	});
	if (change === null) return { error: "no_share" };
	if ("error" in change) return { error: change.error };
	// O pagamento que acabou de entrar é o último: leva o lote (e o comprovante, que a quitação manual não grava sozinha).
	return {
		changed: change.changed,
		shares: change.shares.map((s) => {
			if (s.uid !== targetUid) return s;
			const latest = latestPayment(s);
			if (!latest) return s;
			const batch = { ...o.batch };
			if (latest.kind === "top") {
				const top: ExpenseShare = { ...s, batch };
				if (o.receipt && !top.receipt) top.receipt = o.receipt;
				return top;
			}
			return { ...s, parts: (s.parts ?? []).map((p, k) => (k === latest.index ? { ...p, batch, ...(o.receipt && !p.receipt ? { receipt: o.receipt } : {}) } : p)) };
		}),
	};
}

/**
 * Desfazer de apoio (quando uma parcela já gravada mudou de novo antes do desfazer exato caber): tira o(s) pagamento(s) deste lote
 * USANDO `undoShare` (que mantém a invariante dos pagamentos), um por vez, só enquanto o ÚLTIMO pagamento da parte for do lote.
 * Se a parte mudou de um jeito que não permite desfazer com segurança (ganhou devolução, ou outro pagamento entrou depois do
 * adiantamento), não mexe em nada e devolve `{ unsafe: true }` para quem chama relatar. `null` = a parte não tem pagamento do lote.
 */
export function undoAdvanceSlice(shares: ExpenseShare[], paidBy: string, targetUid: string, batchId: string): { shares: ExpenseShare[] } | { unsafe: true } | null {
	const has = (list: ExpenseShare[]) => {
		const s = list.find((x) => x.uid === targetUid);
		return !!s && ((s.parts ?? []).some((p) => p.batch?.id === batchId) || s.batch?.id === batchId);
	};
	if (!has(shares)) return null;
	let cur = shares;
	for (let k = 0; k < 2 && has(cur); k++) {
		const s = cur.find((x) => x.uid === targetUid)!;
		if (s.refund || latestPayment(s)?.batch?.id !== batchId) return { unsafe: true };
		const undone = undoShare(cur, paidBy, targetUid);
		if (!undone?.changed) return { unsafe: true };
		cur = undone.shares;
	}
	return has(cur) ? { unsafe: true } : { shares: cur };
}
