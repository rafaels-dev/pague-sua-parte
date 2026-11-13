import { formatBRL } from "@/lib/money";
import { maxShare, minPeopleForLimit } from "@/lib/plans/compute";
import { MAX_PLAN_PEOPLE } from "@/lib/plans/collection";
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

/** 80% das pessoas, arredondado para o inteiro mais próximo e nunca menos que 1 (conta inteira). Usado na meta e na sugestão de limite. */
export const eightyPercent = (people: number): number => Math.max(1, Math.floor((8 * people + 5) / 10));

/**
 * A meta do plano, para a tela de quem responde: "13 pessoas · R$ 219,24 cada" e, abaixo, a parte se só 80% forem
 * ("Se só 10 forem: R$ 285,00 para cada um"). Só com previsão de pessoas; sem ela, não há meta. A linha dos 80% some
 * quando o arredondamento não tira ninguém (previsão de 1 ou 2 pessoas).
 */
export function goalLines(r: Pick<PlanResultView, "expectedPeople" | "allCount" | "shareIfAllCents">, totalCents: number): { goal: string; lower: string | null } | null {
	if (!r.expectedPeople || r.shareIfAllCents === null) return null;
	const fewer = eightyPercent(r.allCount);
	const lowerCents = fewer < r.allCount ? maxShare(totalCents, fewer) : null;
	return {
		goal: `${pessoas(r.allCount)} · ${formatBRL(r.shareIfAllCents)} cada`,
		lower: lowerCents === null ? null : `Se só ${fewer} forem: ${formatBRL(lowerCents)} para cada um`,
	};
}

/** "6 de 10 já responderam" e "Faltam responder: 4" (nunca negativo). */
export function scoreLines(r: Pick<PlanResultView, "answeredCount" | "allCount" | "missingCount">): { answered: string; missing: string | null } {
	return {
		answered: `${r.answeredCount} de ${r.allCount} já responderam`,
		missing: r.missingCount > 0 ? `Faltam responder: ${r.missingCount}` : null,
	};
}

/**
 * Linha do cartão de um plano na lista. Plano aberto mostra a meta ("Meta: 13 pessoas · R$ 219,24 cada"), nunca o placar de agora
 * (quantos vão, quanto ficaria hoje): confunde quem acabou de ser convidado. Sem previsão de pessoas, só quantas estão no plano.
 */
export function summaryLine(s: Pick<PlanSummary, "status" | "hasExpense" | "expectedPeople" | "allCount" | "shareIfAllCents" | "peopleCount">): string {
	if (s.status === "cancelled") return "Cancelado";
	if (s.status === "done") return s.hasExpense ? "Virou grupo e despesa" : "Virou grupo";
	if (s.expectedPeople && s.shareIfAllCents !== null) return `Meta: ${pessoas(s.allCount)} · ${formatBRL(s.shareIfAllCents)} cada`;
	return `${pessoas(s.peopleCount)} no plano`;
}

export const ANSWER_LABEL: Record<PlanAnswerState, string> = { going: "Vai", not_going: "Não vai", pending: "Ainda não respondeu" };

/**
 * A frase calma para quem tem limite abaixo da parte de hoje: quantas pessoas precisam confirmar para o limite dela caber.
 * K = menor número de pessoas em que a maior parte da divisão cabe no limite DESTA pessoa (só total e limite dela; nada de limite alheio,
 * nem o valor de hoje). Acima do teto de pessoas do plano: "fica abaixo da parte mesmo com o plano cheio". Sem frase se K <= 1.
 */
export function limitNote(p: Pick<PlanPersonView, "name" | "isYou">, limitCents: number | null, totalCents: number): string | null {
	if (!limitCents || limitCents <= 0) return null;
	const k = minPeopleForLimit(totalCents, limitCents, MAX_PLAN_PEOPLE);
	if (k === null) return "Esse limite fica abaixo da parte mesmo com o plano cheio.";
	if (k <= 1) return null;
	return p.isYou
		? `No valor limite que você pode pagar, você entra na divisão quando pelo menos ${k} pessoas confirmarem.`
		: `No valor limite que ${p.name} pode pagar, ${p.name} entra na divisão quando pelo menos ${k} pessoas confirmarem.`;
}

/** Texto de apoio da resposta: "Vou (até R$ 300,00)" / "Vou (sem limite)" / "Não vou". */
export function myAnswerText(p: Pick<PlanPersonView, "answer" | "limitCents">): string {
	if (p.answer === "not_going") return "Não vou";
	if (p.answer === "going") return p.limitCents ? `Vou (até ${formatBRL(p.limitCents)})` : "Vou (sem limite)";
	return "Ainda não respondeu";
}

/**
 * Página do convite, com foco no valor por pessoa: linha pequena "R$ 2.850,00 dividido por 13 pessoas", valor grande
 * (a parte de cada um) e "Se só 10 confirmarem, o valor muda para R$ 285,00." (80%; some quando não tira ninguém).
 * Sem ao menos 2 pessoas na conta não há valor por pessoa.
 */
export function inviteGoal(i: { totalCents: number; allCount: number; shareIfAllCents: number | null }): { split: string; shareCents: number; lower: string | null } | null {
	if (i.shareIfAllCents === null || i.allCount < 2) return null;
	const fewer = eightyPercent(i.allCount);
	const lowerCents = fewer < i.allCount ? maxShare(i.totalCents, fewer) : null;
	return {
		split: `${formatBRL(i.totalCents)} dividido por ${i.allCount} pessoas`,
		shareCents: i.shareIfAllCents,
		lower: lowerCents === null ? null : `Se só ${fewer} confirmarem, o valor muda para ${formatBRL(lowerCents)}.`,
	};
}

/** Previsão na lista de pessoas de um convite: "Se forem 10 pessoas, fica R$ 250,00 para cada um." */
export function inviteShareLine(allCount: number, shareCents: number | null): string | null {
	return shareCents === null || allCount < 2 ? null : `Se forem ${allCount} pessoas, fica ${formatBRL(shareCents)} para cada um.`;
}

/** Placeholder do campo "Até quanto posso pagar": o valor previsto, sempre com "R$" (sem previsão, "R$ 0,00" como nas outras telas). Não é valor preenchido. */
export function limitPlaceholder(p: SharePreview | null): string {
	return p ? formatBRL(p.cents) : "R$ 0,00";
}

/**
 * A frase ao vivo, enquanto a pessoa digita: mesma ideia do cartão gravado. Aparece quando o limite digitado fica abaixo da parte de hoje
 * (total ÷ quem disse "Vou", contando esta pessoa uma vez só). `goingCount` = quem já disse "Vou" agora (inclui a pessoa se ela já disse).
 * É uma aproximação de propósito: o cliente não sabe quem fica fora da conta pelo limite dos outros (isso só o criador vê), então o cartão
 * gravado (`aboveLimit`, calculado no servidor) pode mostrar a frase em casos em que ela não apareceu aqui.
 */
export function liveLimitNote(p: Pick<PlanPersonView, "name" | "isYou" | "answer">, limitCents: number, totalCents: number, goingCount: number): string | null {
	if (limitCents <= 0) return null;
	const today = maxShare(totalCents, goingCount - (p.answer === "going" ? 1 : 0) + 1);
	return today !== null && limitCents < today ? limitNote(p, limitCents, totalCents) : null;
}

/** Rótulo e apoio do campo somente leitura com o valor planejado pelo organizador (só com previsão de pessoas). */
export const PLANNED_LABEL = "Valor planejado por pessoa";
export const plannedSupport = (p: SharePreview): string => `Se todo mundo confirmar (${p.people} pessoas).`;

/**
 * Sugestão para o campo de limite: a parte se 20% das pessoas previstas não forem. Pessoas = max(1, arredondar(E × 0,8)), em conta inteira
 * (`floor((8E + 5) / 10)`); valor = maior parte da divisão igual (`maxShare`, centavos inteiros). Só com previsão (`basis: "expected"`, E = `people`).
 * `absent` = quantas das E pessoas "saem" na conta (0 quando E é pequeno demais).
 */
export function suggestedLimit(p: SharePreview | null, totalCents: number): { cents: number; absent: number; people: number } | null {
	if (p?.basis !== "expected") return null;
	const people = eightyPercent(p.people);
	const cents = maxShare(totalCents, people);
	return cents === null ? null : { cents, absent: p.people - people, people: p.people };
}

/** Texto de apoio abaixo do campo de limite. */
export function limitHint(p: SharePreview | null, totalCents: number): string {
	const s = suggestedLimit(p, totalCents);
	return s && s.absent > 0
		? `Sugestão: ${formatBRL(s.cents)}, se ${s.absent} das ${s.people} pessoas não forem. Pode mudar, ou apagar se não tem limite.`
		: "Pode mudar, ou apagar se não tem limite.";
}

/** Texto acima do campo de limite: a pergunta. */
export function limitIntro(p: SharePreview | null, who: Pick<PlanPersonView, "name" | "isYou">): string {
	const you = who.isYou ? "você" : who.name;
	return p?.basis === "expected"
		? `Se alguém faltar, a parte de cada um aumenta. Até quanto ${you} pode pagar na nova divisão?`
		: `Se menos gente for, a parte de cada um aumenta. Até quanto ${you} pode pagar?`;
}

/**
 * O que o campo de limite mostra ao abrir: o limite que a pessoa já tem; senão, quem ainda não disse "Vou" recebe a sugestão (parte se 20% das pessoas previstas não forem)
 * (só com previsão de pessoas, `basis: "expected"`). Quem já disse "Vou" sem limite continua sem limite (0). Campo vazio = sem limite.
 */
export function initialLimitCents(p: Pick<PlanPersonView, "answer" | "limitCents" | "preview">, totalCents: number): number {
	if (p.limitCents) return p.limitCents;
	return p.answer !== "going" ? (suggestedLimit(p.preview, totalCents)?.cents ?? 0) : 0;
}

/** O corpo da resposta "Vou": campo vazio (0) = sem limite; o placeholder nunca vira valor. */
export function goingBody(limitCents: number): { going: true; limitCents?: number } {
	return limitCents > 0 ? { going: true, limitCents } : { going: true };
}
