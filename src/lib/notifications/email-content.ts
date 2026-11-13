import { formatBRL } from "@/lib/money";
import type { Notice } from "./types";

/** Tira quebras de linha e caracteres de controle (cabeçalho, texto puro) e junta os espaços. */
export function oneLine(s: string): string {
	return s.replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Assunto curto, de uma linha só. */
export function emailSubject(title: string): string {
	const s = oneLine(title);
	return s.length > 100 ? `${s.slice(0, 99)}…` : s || "Aviso do PagueSuaParte";
}

/** Link absoluto sempre no endereço do app: caminho que não começa por uma barra simples volta para a raiz. */
export function appLink(baseUrl: string, path: string): string {
	const base = baseUrl.replace(/\/+$/, "");
	if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) return base;
	return `${base}${path}`;
}

/** O texto do botão (uma ação só), pelo destino do aviso. */
export function ctaLabel(url: string): string {
	if (url.includes("/despesas/")) return "Ver a despesa";
	if (url.startsWith("/app/planos/")) return "Ver o plano";
	if (url.startsWith("/app/pagar")) return "Ver o que pagar";
	if (url.startsWith("/app/receber")) return "Ver o que receber";
	if (url.startsWith("/app/grupos/")) return "Ver o grupo";
	return "Abrir o PagueSuaParte";
}

/** O valor em destaque, só quando o aviso traz valor E a legenda que diz o que ele é. */
export function highlight(n: Pick<Notice, "amountCents" | "amountLabel">): { label: string; value: string } | null {
	if (typeof n.amountCents !== "number" || !Number.isFinite(n.amountCents) || n.amountCents <= 0) return null;
	const label = n.amountLabel ? oneLine(n.amountLabel) : "";
	return label ? { label, value: formatBRL(n.amountCents) } : null;
}

/** Por que a pessoa recebeu o aviso. */
export function reasonLine(scope: Notice["scope"]): string {
	if (scope?.kind === "account") return "Você recebe este e-mail porque criou uma conta no PagueSuaParte.";
	const name = scope ? oneLine(scope.name) : "";
	if (scope && name) return `Você recebe este aviso porque participa ${scope.kind === "plan" ? "do plano" : "do grupo"} ${name} no PagueSuaParte.`;
	return "Você recebe este aviso porque tem conta no PagueSuaParte.";
}

/** Resumo curto que aparece ao lado do assunto na caixa de entrada. */
export function preheader(body: string): string {
	const s = oneLine(body);
	return s.length > 110 ? `${s.slice(0, 109)}…` : s;
}

export const SETTINGS_PATH = "/app/perfil";

/** A versão em texto puro (sempre enviada junto): sem HTML, uma linha por parte, nada de chave Pix. */
export function buildEmailText(n: Notice, baseUrl: string): string {
	const hi = highlight(n);
	const lines = [oneLine(n.title), "", oneLine(n.body)];
	if (n.list?.length) lines.push("", ...n.list.map((i) => `- ${oneLine(i)}`));
	if (n.next) lines.push("", oneLine(n.next));
	if (hi) lines.push("", `${hi.label}: ${hi.value}`);
	lines.push("", `${ctaLabel(n.url)}: ${appLink(baseUrl, n.url)}`, "", "--", reasonLine(n.scope), `Mudar meus avisos: ${appLink(baseUrl, SETTINGS_PATH)}`, "");
	return lines.join("\n");
}
