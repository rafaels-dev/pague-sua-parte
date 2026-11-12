import { formatBRL } from "@/lib/money";
import { inviteShareLine } from "./plans";
import { formatDateLong } from "./dates";
import type { PlanResultView } from "@/lib/plans/view";

export type PlanShareData = {
	name: string;
	totalCents: number;
	eventDate: string | null;
	details: string | null;
	result: Pick<PlanResultView, "expectedPeople" | "allCount" | "shareIfAllCents">;
};

export const SHARE_DETAILS_MAX = 160;

/** Trecho curto dos detalhes: uma linha só, cortada com "…". */
export function detailsSnippet(details: string | null, max = SHARE_DETAILS_MAX): string | null {
	const flat = (details ?? "").replace(/\s+/g, " ").trim();
	if (!flat) return null;
	const chars = Array.from(flat);
	return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : flat;
}

/**
 * Texto do plano para o WhatsApp: nome, valor, quando, a previsão por pessoa e o link de convite.
 * Sem placar (quantos vão, quantos faltam, quanto fica hoje): muda a toda hora e a mensagem fica velha.
 * Nunca leva limite de ninguém, nem fotos, nem chave Pix.
 */
export function buildPlanShareText(p: PlanShareData, inviteLink: string): string {
	const r = p.result;
	const lines = [`*${p.name.trim()}*`, `Valor: ${formatBRL(p.totalCents)}`];
	if (p.eventDate) lines.push(`Quando: ${formatDateLong(p.eventDate)}`);
	const snippet = detailsSnippet(p.details);
	if (snippet) lines.push(snippet);
	const estimate = r.expectedPeople ? inviteShareLine(r.allCount, r.shareIfAllCents) : null;
	if (estimate) lines.push("", estimate);
	lines.push("", `Diga se você vai: ${inviteLink}`);
	return lines.join("\n");
}

export function planShareIntro(): string {
	return "Mande o convite para quem você quer chamar. Quem abrir o link entra no plano e diz se vai.";
}

export function buildPlanLink(origin: string, token: string): string {
	return `${origin.replace(/\/+$/, "")}/convite/plano/${encodeURIComponent(token)}`;
}

export function buildPlanPageLink(origin: string, planId: string): string {
	return `${origin.replace(/\/+$/, "")}/app/planos/${encodeURIComponent(planId)}`;
}
