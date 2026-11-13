import { addDays, todayInSaoPaulo } from "@/lib/expenses/dates";
import type { PlanDoc } from "./collection";

/** Sem data do evento, o link do plano que virou grupo vale por tantos dias depois do fechamento. */
export const GROUP_LINK_GRACE_DAYS = 7;

/**
 * Último dia (YYYY-MM-DD, São Paulo, INCLUSIVE) em que o link de um plano já fechado ainda leva ao grupo: a data do evento;
 * sem ela, ou se o plano fechou DEPOIS do dia do evento, 7 dias depois do fechamento (`closedAt`, ou `updatedAt` em plano antigo).
 */
export function groupLinkLastDay(plan: Pick<PlanDoc, "eventDate" | "closedAt" | "updatedAt">): string {
	const closedDay = todayInSaoPaulo(plan.closedAt ?? plan.updatedAt);
	if (plan.eventDate && closedDay <= plan.eventDate) return plan.eventDate;
	return addDays(closedDay, GROUP_LINK_GRACE_DAYS);
}

/** O link do plano fechado ainda leva ao grupo agora? (A validade do próprio convite, `invite.expiresAt`, é conferida à parte.) */
export function groupLinkOpen(plan: Pick<PlanDoc, "eventDate" | "closedAt" | "updatedAt">, now: Date = new Date()): boolean {
	return todayInSaoPaulo(now) <= groupLinkLastDay(plan);
}
