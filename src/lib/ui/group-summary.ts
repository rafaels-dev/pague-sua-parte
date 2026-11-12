import { formatBRL } from "@/lib/money";

/** Resumo do grupo inteiro para o WhatsApp (formato de `GET /api/groups/:id/summary`). Só nomes: nunca chave Pix. */
export type GroupSummaryData = {
	groupName: string;
	totalOpenCents: number;
	overdueCents: number;
	debts: { fromName: string; toName: string; cents: number; overdue: boolean; refund: boolean }[];
	moreDebts: number;
	upToDate: string[];
	moreUpToDate: number;
	/** Despesas em aberto demais: os valores estão incompletos e "quem está em dia" não é confiável. */
	partial?: boolean;
};

/** Quantas linhas de "quem deve" cabem na mensagem (o resto vira "e mais N"). */
export const SUMMARY_MAX_LINES = 20;
const MAX_NAMES = 12;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Aceita a resposta da API; o que faltar vira vazio, para a tela nunca quebrar. */
export function normalizeGroupSummary(raw: unknown): GroupSummaryData {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const debts = (Array.isArray(r.debts) ? r.debts : []).flatMap((d) => {
		if (!d || typeof d !== "object") return [];
		const x = d as Record<string, unknown>;
		const cents = num(x.cents);
		return cents > 0 ? [{ fromName: str(x.fromName, "Participante"), toName: str(x.toName, "Participante"), cents, overdue: x.overdue === true, refund: x.refund === true }] : [];
	});
	return {
		groupName: str(r.groupName, "Grupo"),
		totalOpenCents: num(r.totalOpenCents),
		overdueCents: num(r.overdueCents),
		debts,
		moreDebts: Math.max(0, num(r.moreDebts)),
		upToDate: (Array.isArray(r.upToDate) ? r.upToDate : []).filter((n): n is string => typeof n === "string"),
		moreUpToDate: Math.max(0, num(r.moreUpToDate)),
		partial: r.partial === true,
	};
}

function nameList(names: string[], more: number): string {
	const shown = names.slice(0, MAX_NAMES);
	const rest = names.length - shown.length + more;
	const items = rest > 0 ? [...shown, `mais ${rest}`] : shown;
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/**
 * Mensagem do resumo do grupo, igual para quem compartilhar (não é o saldo de quem manda).
 * Linhas curtas, `*negrito*` só no título e no total; valores em reais. Passou de `maxLines` linhas de dívida: "e mais N".
 */
export function buildGroupSummaryText(s: GroupSummaryData, link: string, maxLines = SUMMARY_MAX_LINES): string {
	const name = s.groupName.trim() || "Grupo";
	const PARTIAL = "Atenção: resumo incompleto (são muitas despesas em aberto). Veja tudo no app.";
	if (!s.partial && (s.totalOpenCents <= 0 || s.debts.length === 0)) {
		const all = nameList(s.upToDate, s.moreUpToDate);
		return [`*Resumo do grupo ${name}*`, "Tudo certo: ninguém deve nada.", ...(all ? [`Em dia: ${all}`] : []), "", `Veja os detalhes: ${link}`].join("\n");
	}
	// Por pessoa (ordem alfabética), partes a pagar antes das devoluções, maiores valores primeiro.
	const sorted = [...s.debts].sort(
		(a, b) => a.fromName.localeCompare(b.fromName, "pt-BR") || Number(a.refund) - Number(b.refund) || b.cents - a.cents || a.toName.localeCompare(b.toName, "pt-BR"),
	);
	const line = (d: GroupSummaryData["debts"][number]) =>
		d.refund ? `${d.fromName} devolve ${formatBRL(d.cents)} para ${d.toName}` : `${d.fromName} deve ${formatBRL(d.cents)} a ${d.toName}${d.overdue ? " (atrasado)" : ""}`;
	const shown = sorted.slice(0, maxLines).map(line);
	const hidden = sorted.length - shown.length + s.moreDebts;
	const lines = [`*Resumo do grupo ${name}*`, `${s.partial ? "Em aberto (parcial)" : "Ainda em aberto"}: *${formatBRL(s.totalOpenCents)}*`];
	if (s.overdueCents > 0) lines.push(`Atrasado: ${formatBRL(s.overdueCents)}`);
	lines.push("", ...shown);
	if (hidden > 0) lines.push(`e mais ${hidden}`);
	// Com o resumo incompleto, não dá para afirmar quem está em dia: a linha some.
	const all = s.partial ? "" : nameList(s.upToDate, s.moreUpToDate);
	if (all) lines.push("", `Em dia: ${all}`);
	if (s.partial) lines.push("", PARTIAL);
	lines.push("", `Veja os detalhes: ${link}`);
	return lines.join("\n");
}

/** Endereço da página do grupo, para mandar no resumo. */
export function buildGroupLink(origin: string, groupId: string): string {
	return `${origin.replace(/\/+$/, "")}/app/grupos/${encodeURIComponent(groupId)}`;
}
