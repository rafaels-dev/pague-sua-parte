import { formatBRL } from "@/lib/money";
import { clipText } from "./text";
import type { Notice } from "./types";

/** Controle, separadores de linha e marcas de direção (bidi): viram um espaço (separam o que estava junto). */
const SEPARATORS = /[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]+/g;
/** Largura zero (U+061C, U+200B, U+200C, U+2060): somem SEM inserir espaço, para não partir palavras de idiomas que as usam (persa, por exemplo). */
const ZERO_WIDTH = /[\u061c\u200b\u200c\u2060]+/g;
/** U+200D (junção de largura zero) só vale DENTRO de uma sequência de emoji (👩‍👧); solto, é invisível e some, também sem espaço. */
const STRAY_ZWJ = /(?<![\p{Extended_Pictographic}\uFE0F\u{1F3FB}-\u{1F3FF}])\u200d|\u200d(?!\p{Extended_Pictographic})/gu;

/** Tira quebras de linha e caracteres de controle ou invisíveis (cabeçalho, texto puro) e junta os espaços; emojis compostos ficam intactos. */
export function oneLine(s: string): string {
	return s.replace(SEPARATORS, " ").replace(ZERO_WIDTH, "").replace(STRAY_ZWJ, "").replace(/\s+/g, " ").trim();
}

/** Assunto curto, de uma linha só. */
export function emailSubject(title: string): string {
	const s = oneLine(title);
	return s ? clipText(s, 100) : "Aviso do PagueSuaParte";
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
	return clipText(s, 110);
}

export const SETTINGS_PATH = "/app/perfil";

/** Sobre o comprovante: "attached" (foi em anexo), "app" ou "app_many" (existe, mas não coube ou não é um arquivo só: veja no app). */
export type ReceiptLine = "attached" | "app" | "app_many";
export const receiptLineText = (l: ReceiptLine | undefined): string | null =>
	l === "attached" ? "O comprovante está em anexo." : l === "app" ? "Veja o comprovante no app." : l === "app_many" ? "Veja os comprovantes no app." : null;

/** O assunto do e-mail: o resumo (`subject`) do aviso, ou o título quando não há. */
export const noticeSubject = (n: Pick<Notice, "title" | "subject">): string => emailSubject(n.subject?.trim() ? n.subject : n.title);

/** A versão em texto puro (sempre enviada junto): sem HTML, uma linha por parte, nada de chave Pix. */
export function buildEmailText(n: Notice, baseUrl: string, receipt?: ReceiptLine): string {
	const hi = highlight(n);
	const lines = [oneLine(n.title), "", oneLine(n.body)];
	const rl = receiptLineText(receipt);
	if (rl) lines.push("", rl);
	if (n.list?.length) lines.push("", ...n.list.map((i) => `- ${oneLine(i)}`));
	if (n.next) lines.push("", oneLine(n.next));
	if (hi) lines.push("", `${hi.label}: ${hi.value}`);
	lines.push("", `${ctaLabel(n.url)}: ${appLink(baseUrl, n.url)}`, "", "--", reasonLine(n.scope), `Mudar meus avisos: ${appLink(baseUrl, SETTINGS_PATH)}`, "");
	return lines.join("\n");
}
