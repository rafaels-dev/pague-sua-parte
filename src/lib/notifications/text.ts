/** Corte de texto seguro para emoji e letras compostas (por grafema). */
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("pt-BR", { granularity: "grapheme" }) : null;
const graphemes = (s: string): string[] => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

/**
 * Corta `s` para caber em `max` unidades (`.length`), com reticências, SEM partir emoji nem letra com acento composto
 * (corta por grafema). Cabendo, devolve igual.
 */
export function clipText(s: string, max = 60): string {
	if (s.length <= max) return s;
	let out = "";
	for (const g of graphemes(s)) {
		if (out.length + g.length > max - 1) break;
		out += g;
	}
	return `${out.trimEnd()}…`;
}

