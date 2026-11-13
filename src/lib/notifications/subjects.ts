import { oneLine } from "./email-content";
import { clipText } from "./text";

export { clipText };

export const SUBJECT_MAX = 80;

/** Nome de pessoa em assunto: curto, para nunca empurrar o valor para fora. */
export const shortName = (s: string, max = 24): string => clipText(oneLine(s), max);

/** Tamanhos máximos tentados para nomes de pessoas, do mais folgado ao mais apertado. */
const PERSON_MAX = [24, 12, 6, 2];

/**
 * Assunto de e-mail que NUNCA passa de `max` (`.length`). `build` recebe o nome principal (despesa, grupo ou plano) e o tamanho máximo
 * a usar nos nomes de pessoas (`shortName(x, p)`). Primeiro corta só o nome principal (reticências, por grafema); se não bastar,
 * encurta também os nomes de pessoas; o valor nunca é cortado. Última defesa: corta o texto pronto (nunca deveria ser preciso).
 */
export function fitSubject(build: (name: string, personMax: number) => string, name: string, max: number = SUBJECT_MAX): string {
	const clean = oneLine(name);
	for (const p of PERSON_MAX) {
		const full = oneLine(build(clean, p));
		if (full.length <= max) return full;
		const over = full.length - max;
		const short = oneLine(build(clipText(clean, Math.max(2, clean.length - over)), p));
		if (short.length <= max) return short;
		const least = oneLine(build(clipText(clean, 2), p));
		if (least.length <= max) {
			// Ainda sobra um pouco: reduz de grafema em grafema até caber.
			for (let n = clean.length - over; n >= 2; n--) {
				const t = oneLine(build(clipText(clean, n), p));
				if (t.length <= max) return t;
			}
			return least;
		}
	}
	return clipText(oneLine(build(clipText(clean, 2), 2)), max);
}

/** Assunto sem nome variável: só tira quebras de linha (os textos já são curtos). */
export const plainSubject = (s: string): string => oneLine(s);
