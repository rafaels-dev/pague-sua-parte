import { formatBRL } from "@/lib/money";
import type { SharePreview } from "@/lib/plans/preview";
import type { PlanAnswerState, PlanPersonView, PlanResultView, PlanSummary } from "@/lib/plans/view";

const pessoas = (n: number) => (n === 1 ? "1 pessoa" : `${n} pessoas`);

/** Destaque da tela do plano: "Fecha com 9 pessoas · R$ 277,78 cada" ou "Ainda não fecha". */
export function resultHeadline(r: Pick<PlanResultView, "fits" | "shareCents" | "includedCount">): string {
	return r.fits && r.shareCents !== null ? `Fecha com ${pessoas(r.includedCount)} · ${formatBRL(r.shareCents)} cada` : "Ainda não fecha";
}

/** "Com mais 1 pessoa fecha em R$ 277,78 para cada um." (ou "cai para", quando já fecha). */
export function hintLine(r: Pick<PlanResultView, "fits" | "hint">): string | null {
	if (!r.hint) return null;
	const mais = r.hint.extraPeople === 1 ? "mais 1 pessoa" : `mais ${r.hint.extraPeople} pessoas`;
	return `Com ${mais} ${r.fits ? "cai para" : "fecha em"} ${formatBRL(r.hint.shareCents)} para cada um.`;
}

/** "Se forem as 10 pessoas: R$ 250,00 para cada um" (previsão do criador) ou "Se todos os 4 forem: ..." (pessoas no plano). */
export function ifAllLine(r: Pick<PlanResultView, "expectedPeople" | "allCount" | "shareIfAllCents" | "peopleCount">): string | null {
	if (r.shareIfAllCents === null) return null;
	if (r.expectedPeople) return `Se forem as ${r.allCount} pessoas: ${formatBRL(r.shareIfAllCents)} para cada um`;
	if (r.peopleCount < 2) return null;
	return `Se todos os ${r.peopleCount} forem: ${formatBRL(r.shareIfAllCents)} para cada um`;
}

/** "6 de 10 já responderam" e "Faltam responder: 4" (nunca negativo). */
export function scoreLines(r: Pick<PlanResultView, "answeredCount" | "allCount" | "missingCount">): { answered: string; missing: string | null } {
	return {
		answered: `${r.answeredCount} de ${r.allCount} já responderam`,
		missing: r.missingCount > 0 ? `Faltam responder: ${r.missingCount}` : null,
	};
}

/** Linha do cartão de um plano na lista. */
export function summaryLine(s: Pick<PlanSummary, "fits" | "shareCents" | "includedCount" | "goingCount" | "status">): string {
	if (s.status === "cancelled") return "Cancelado";
	if (s.status === "done") return "Virou grupo e despesa";
	if (s.fits && s.shareCents !== null) return `${s.includedCount} ${s.includedCount === 1 ? "vai" : "vão"} · ${formatBRL(s.shareCents)} cada`;
	return s.goingCount > 0 ? `${s.goingCount} ${s.goingCount === 1 ? "vai" : "vão"} · Ainda não fecha` : "Ainda não fecha";
}

export const ANSWER_LABEL: Record<PlanAnswerState, string> = { going: "Vai", not_going: "Não vai", pending: "Ainda não respondeu" };

/** "Do jeito que está, sua parte seria R$ X, acima do seu limite de R$ Y. Você vai ou não?" */
export function aboveLimitQuestion(p: Pick<PlanPersonView, "name" | "isYou" | "limitCents" | "shareIfIncludedCents">): string | null {
	if (p.limitCents === null || p.shareIfIncludedCents === null) return null;
	return p.isYou
		? `Do jeito que está, sua parte seria ${formatBRL(p.shareIfIncludedCents)}, acima do seu limite de ${formatBRL(p.limitCents)}. Você vai ou não?`
		: `Do jeito que está, a parte de ${p.name} seria ${formatBRL(p.shareIfIncludedCents)}, acima do limite de ${formatBRL(p.limitCents)}. ${p.name} vai ou não?`;
}

/** Texto de apoio da resposta: "Vou (até R$ 300,00)" / "Vou (sem limite)" / "Não vou". */
export function myAnswerText(p: Pick<PlanPersonView, "answer" | "limitCents">): string {
	if (p.answer === "not_going") return "Não vou";
	if (p.answer === "going") return p.limitCents ? `Vou (até ${formatBRL(p.limitCents)})` : "Vou (sem limite)";
	return "Ainda não respondeu";
}

/** Previsão na lista de pessoas de um convite: "Se forem 10 pessoas, fica R$ 250,00 para cada um." */
export function inviteShareLine(allCount: number, shareCents: number | null): string | null {
	return shareCents === null || allCount < 2 ? null : `Se forem ${allCount} pessoas, fica ${formatBRL(shareCents)} para cada um.`;
}

/** Placeholder do campo "Até quanto posso pagar": o valor previsto, sempre com "R$" (sem previsão, "R$ 0,00" como nas outras telas). Não é valor preenchido. */
export function limitPlaceholder(p: SharePreview | null): string {
	return p ? formatBRL(p.cents) : "R$ 0,00";
}

const OPTIONAL = "Deixe vazio se não tem limite.";

/** Texto de apoio abaixo do campo de limite: o indicativo e, na mesma mensagem, que o campo é opcional. */
export function limitHint(p: SharePreview | null): string {
	if (!p) return OPTIONAL;
	const base =
		p.basis === "expected"
			? `Previsto: ${formatBRL(p.cents)} para cada um, se forem as ${p.people} pessoas.`
			: p.basis === "plan"
				? `Se forem as ${p.people} pessoas do plano: ${formatBRL(p.cents)} para cada um.`
				: `Hoje ficaria ${formatBRL(p.cents)} para cada um.`;
	return `${base} ${OPTIONAL}`;
}

/** Aviso leve (não bloqueia) quando o limite digitado fica abaixo do valor previsto. */
export function belowPreviewNote(limitCents: number, p: SharePreview | null): string | null {
	return p && limitCents > 0 && limitCents < p.cents ? "Abaixo do valor previsto. Você só entra se mais gente for." : null;
}

/** O corpo da resposta "Vou": campo vazio (0) = sem limite; o placeholder nunca vira valor. */
export function goingBody(limitCents: number): { going: true; limitCents?: number } {
	return limitCents > 0 ? { going: true, limitCents } : { going: true };
}
