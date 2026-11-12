import { buildExpenseLink } from "./expense-share";
import { buildGroupLink } from "./group-summary";
import { buildInviteLink } from "./invite";

/**
 * Link dos textos compartilhados: o convite do grupo (`/convite/<token>?ir=<destino>`).
 * Quem já é do grupo vai direto ao destino; quem não é vê o convite e, ao entrar, cai no destino.
 * O link da própria página (`/app/grupos/...`) não serve para quem está de fora, e abrir o link NUNCA
 * entra no grupo sozinho: sempre há o convite com o botão "Entrar no grupo".
 */

/** Destino (caminho do app) da página do grupo. */
export function groupDestination(groupId: string): string {
	return `/app/grupos/${encodeURIComponent(groupId)}`;
}

/** Destino (caminho do app) da página de uma despesa. */
export function expenseDestination(groupId: string, expenseId: string): string {
	return `${groupDestination(groupId)}/despesas/${encodeURIComponent(expenseId)}`;
}

export function buildInviteDestinationLink(origin: string, token: string, destination: string): string {
	return `${buildInviteLink(origin, token)}?ir=${encodeURIComponent(destination)}`;
}

/** Link do resumo do grupo: o convite com destino no grupo; sem token (falha ao obter), o link simples da página. */
export function groupShareLink(origin: string, token: string | null, groupId: string): string {
	return token ? buildInviteDestinationLink(origin, token, groupDestination(groupId)) : buildGroupLink(origin, groupId);
}

export type ExpenseShareKind = "launched" | "manual" | "summary" | "paid" | "refund";

/**
 * Só despesa lançada, cobrança e resumo da despesa levam o convite. "Paguei" e "devolvi" vão para quem já é do
 * grupo: levam o link simples da página (menos exposição do token).
 */
export function expenseShareCarriesInvite(kind: ExpenseShareKind): boolean {
	return kind === "launched" || kind === "manual" || kind === "summary";
}

/** Link do texto de uma despesa: convite com destino (se o tipo leva e há token) ou o link simples da página. */
export function expenseShareLink(kind: ExpenseShareKind, origin: string, token: string | null, groupId: string, expenseId: string): string {
	return expenseShareCarriesInvite(kind) && token
		? buildInviteDestinationLink(origin, token, expenseDestination(groupId, expenseId))
		: buildExpenseLink(origin, groupId, expenseId);
}

/** Só letras, números, "_" e "-" por trecho: sem "..", "%", "\", "//", esquema, host, consulta ou "#". */
const DESTINATION = /^\/app\/grupos\/([A-Za-z0-9_-]{1,64})((?:\/[A-Za-z0-9_-]{1,64}){0,4})$/;

/** Código do grupo de um destino bem formado; null se o destino não for aceito. */
export function destinationGroupId(raw: string | null | undefined): string | null {
	if (typeof raw !== "string" || raw.length > 300) return null;
	const m = DESTINATION.exec(raw);
	return m ? m[1] : null;
}

/**
 * Destino (`ir`) aceito depois de abrir o convite: caminho relativo do app que começa exatamente em
 * `/app/grupos/<grupo DESTE convite>`. `raw` já vem decodificado uma vez (URLSearchParams/searchParams);
 * não decodificamos de novo. Qualquer outra coisa (outro grupo, outro site, "//", "\", "..") vira null
 * e quem chama usa a página do grupo (impede redirecionamento para fora do app).
 */
export function safeInviteDestination(raw: string | null | undefined, groupId: string): string | null {
	const gid = destinationGroupId(raw);
	return gid !== null && gid === groupId ? (raw as string) : null;
}

/** Aviso do sheet de compartilhar quando só há uma pessoa com login no grupo (o link agora é um convite). */
export const SOLO_SHARE_NOTICE = "Ninguém mais está no grupo ainda. Quem receber o link vai poder entrar no grupo.";
/** Complemento para despesas: quem entra pelo link não entra sozinho na divisão. */
export const SOLO_SHARE_EXPENSE_HINT = "Depois, inclua a pessoa em “Mudar quem divide”.";
