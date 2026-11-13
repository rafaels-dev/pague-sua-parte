/** Textos e decisões puras da folha "Adiantar parcelas" (sem React). A conta em si é `distributeAdvance`. */

import { formatBRL } from "@/lib/money";
import { buildPixPayload, descriptionBudget } from "@/lib/pix/brcode";
import { shareMessage } from "@/lib/pix/message";
import { advanceDoneClause, advancePreview, distributeAdvance, type AdvanceItem, type AdvanceSummaryItem } from "@/lib/payments/advance";

/** O que o servidor devolve em GET .../advance: as parcelas em aberto da pessoa na compra toda (da mais antiga para a mais nova). */
export type AdvancePlanData = {
	shareUid: string;
	/** Parcela que a tela tem aberta; o adiantamento começa na mais antiga em aberto, não nesta. */
	currentNumber: number;
	thisDueCents: number;
	totalDueCents: number;
	items: { id: string; number: number; dueDate: string | null; dueCents: number }[];
	/** Quem recebe estas parcelas; `pix` só vem ao pagar (null = sem chave Pix cadastrada). */
	recipient: { id: string; name: string; pix: { type: string; key: string; payeeName: string } | null } | null;
	/** Há parcelas em aberto mais novas que vão para outro destinatário (ou outra chave): ficam de fora. */
	moreRecipients: boolean;
};

/** O que o servidor devolve depois de gravar (o que foi de fato gravado). */
export type AdvanceDoneData = { totalCents: number; items: AdvanceSummaryItem[]; hasReceipt: boolean; batchId: string };

/**
 * Rótulo do link na despesa parcelada. Num caminho só: em compra parcelada o valor sempre abate das parcelas em aberto na ordem
 * (a mais antiga primeiro); o "pagar outro valor só desta parcela" da despesa comum não existe aqui, para não haver dois caminhos.
 */
export const ADVANCE_LINK = "Adiantar parcelas ou pagar outro valor";

export const planItems = (plan: AdvancePlanData): AdvanceItem[] => plan.items.map((i) => ({ id: i.id, number: i.number, dueCents: i.dueCents }));

export type AdvanceShortcut = { key: "first" | "two" | "all"; label: string; cents: number };

/**
 * Atalhos de valor, na ordem em que o dinheiro vai: a próxima parcela em aberto ("Próxima parcela (nº 2)"), "As 2 próximas" (quando há
 * mais de duas em aberto) e "Tudo que falta". Nenhum repete o valor de outro.
 */
export function advanceShortcuts(plan: AdvancePlanData): AdvanceShortcut[] {
	const open = [...plan.items].filter((i) => i.dueCents > 0).sort((a, b) => a.number - b.number);
	if (open.length === 0) return [];
	const out: AdvanceShortcut[] = [{ key: "first", label: open.length === 1 ? `Parcela ${open[0].number}` : `Próxima parcela (nº ${open[0].number})`, cents: open[0].dueCents }];
	if (open.length > 2) out.push({ key: "two", label: "As 2 próximas", cents: open[0].dueCents + open[1].dueCents });
	if (open.length > 1) out.push({ key: "all", label: plan.moreRecipients && plan.recipient ? `Tudo para ${plan.recipient.name.split(" ")[0]}` : "Tudo que falta", cents: plan.totalDueCents });
	return out;
}

export type AdvanceCheck =
	| { kind: "empty" }
	| { kind: "too_much"; message: string }
	| { kind: "ok"; preview: string; /** Quando há parcela em aberto mais antiga que a aberta na tela: o dinheiro vai primeiro para ela. */ note: string | null; items: AdvanceSummaryItem[] };

/** Confere o valor digitado e monta a prévia ao vivo, com a MESMA função que o servidor usa para gravar. */
export function checkAdvance(plan: AdvancePlanData, cents: number): AdvanceCheck {
	const r = distributeAdvance(planItems(plan), cents);
	if (!r.ok) {
		return r.error === "too_much" ? { kind: "too_much", message: `Esse valor é maior do que falta pagar (${formatBRL(plan.totalDueCents)}).` } : { kind: "empty" };
	}
	const items = r.allocations.map((a) => ({ number: a.number, cents: a.cents, settled: a.settles, remainingCents: a.remainingCents }));
	const first = items[0].number;
	const note = first < plan.currentNumber ? `A parcela ${first} está em aberto: o dinheiro vai primeiro para ela.` : null;
	return { kind: "ok", items, preview: advancePreview(items), note };
}

/** Frase única para quando há parcelas em aberto que vão para outra pessoa (ou outra chave Pix): ficam para depois. */
export const OTHER_RECIPIENT_NOTE = "As outras parcelas em aberto vão para outra pessoa ou outra chave Pix. Pague essas depois, uma de cada vez.";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mensagem curta depois de registrar. `forName`: quem recebeu ("Recebi") ou a pessoa cuidada ("Paguei por"). */
export function advanceDoneMessage(adv: AdvanceDoneData, o: { mode: "self" | "manual"; name: string }): string {
	const clause = advanceDoneClause(adv.items);
	return o.mode === "manual" ? `Recebido ${formatBRL(adv.totalCents)} de ${o.name}: ${clause}.` : `Pronto! ${cap(clause)}.`;
}

/**
 * Código "Copia e Cola" de um adiantamento: usa quem recebe e a chave das parcelas que o dinheiro vai quitar (vindas do plano, não
 * da parcela aberta na tela) e uma descrição SEM "parcela N de M" (o valor pode pagar várias). null se não dá para gerar.
 */
export function advancePayload(plan: AdvancePlanData, description: string, cents: number): string | null {
	const pix = plan.recipient?.pix;
	if (!pix || cents < 1) return null;
	try {
		return buildPixPayload({ key: pix.key, payeeName: pix.payeeName, amountCents: cents, description: shareMessage(description, null, descriptionBudget(pix.key)) });
	} catch {
		return null;
	}
}
