import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

/** Lê as variáveis --md-* do bloco :root (claro) ou do :root dentro de prefers-color-scheme: dark. */
function palette(dark: boolean): Record<string, string> {
	const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
	const themeStart = css.indexOf("@theme inline");
	const block = dark ? css.slice(darkStart, themeStart) : css.slice(0, darkStart);
	const vars: Record<string, string> = {};
	for (const m of block.matchAll(/--md-([a-z-]+):\s*(#[0-9a-f]{6})/gi)) vars[m[1]] = m[2];
	return vars;
}

// [texto, fundo, mínimo]: 4.5 para texto; 3 para texto grande (>= 24px) e componentes de UI.
const TEXT_PAIRS: Array<[string, string, number]> = [
	["on-primary", "primary", 4.5],
	["on-primary-container", "primary-container", 4.5],
	["on-secondary-container", "secondary-container", 4.5],
	["on-tertiary-container", "tertiary-container", 4.5],
	["on-error-container", "error-container", 4.5],
	["on-error", "error", 4.5],
	["inverse-on-surface", "inverse-surface", 4.5],
	["on-surface", "surface", 4.5],
	["on-surface", "surface-container-low", 4.5],
	["on-surface", "surface-container", 4.5],
	["on-surface", "surface-container-high", 4.5],
	["on-surface-variant", "surface", 4.5],
	["on-surface-variant", "surface-container-low", 4.5],
	["on-surface-variant", "surface-container", 4.5],
	["on-surface-variant", "surface-container-high", 4.5],
	["primary", "surface", 4.5],
	["primary", "surface-container-low", 4.5],
	["primary", "surface-container-high", 4.5],
	["error", "surface", 4.5],
	["error", "surface-container-low", 4.5],
	["error", "surface-container-high", 4.5],
	["receive", "surface", 4.5],
	["receive", "surface-container-high", 4.5],
	["on-primary", "primary", 4.5],
];
// Bordas e indicadores (WCAG 1.4.11: 3:1).
const UI_PAIRS: Array<[string, string, number]> = [
	["outline", "surface", 3],
	["outline", "surface-container-low", 3],
	["primary", "surface", 3],
];

describe.each([
	["claro", false],
	["escuro", true],
])("contraste AA (%s)", (_name, dark) => {
	const p = palette(dark);
	it.each([...TEXT_PAIRS, ...UI_PAIRS])("%s sobre %s >= %s", (fg, bg, min) => {
		expect(p[fg], `variável ${fg}`).toBeDefined();
		expect(p[bg], `variável ${bg}`).toBeDefined();
		expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(min);
	});
});
