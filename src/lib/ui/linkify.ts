export type TextPiece = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
/** Pontuação que costuma vir colada ao fim de um link num texto corrido. */
const TRAILING = /[.,;:!?'")\]}]+$/;

function trimLink(raw: string): string {
	let url = raw;
	while (TRAILING.test(url)) {
		const last = url[url.length - 1];
		// ")" faz parte do link quando ele tem um "(" ainda sem par (ex.: páginas da Wikipédia).
		if (last === ")" && (url.match(/\(/g) ?? []).length >= (url.match(/\)/g) ?? []).length) break;
		url = url.slice(0, -1);
	}
	return url;
}

/**
 * Quebra um texto em pedaços de texto e links. Só `http` e `https` viram link (nada de `javascript:` nem `data:`);
 * o resto continua texto. Para exibir, use React (texto + âncoras), nunca HTML cru.
 */
export function linkify(text: string): TextPiece[] {
	const out: TextPiece[] = [];
	let last = 0;
	for (const m of text.matchAll(URL_RE)) {
		const start = m.index ?? 0;
		const url = trimLink(m[0]);
		let href: string | null = null;
		try {
			const u = new URL(url);
			if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname) href = u.href;
		} catch {
			href = null;
		}
		if (!href) continue;
		if (start > last) out.push({ type: "text", text: text.slice(last, start) });
		out.push({ type: "link", text: url, href });
		last = start + url.length;
	}
	if (last < text.length) out.push({ type: "text", text: text.slice(last) });
	return out;
}
