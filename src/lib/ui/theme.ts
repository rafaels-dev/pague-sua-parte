/** Tema escolhido no menu da conta: "auto" segue o sistema; "light" e "dark" valem mais que ele. Fica só neste aparelho. */
export type Theme = "auto" | "light" | "dark";

export const THEME_KEY = "tema";

/** Roda antes da primeira pintura (no <head>) para a tela não piscar no tema errado. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function readTheme(): Theme {
	try {
		const t = localStorage.getItem(THEME_KEY);
		return t === "light" || t === "dark" ? t : "auto";
	} catch {
		return "auto";
	}
}

export function applyTheme(theme: Theme): void {
	if (theme === "auto") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	try {
		if (theme === "auto") localStorage.removeItem(THEME_KEY);
		else localStorage.setItem(THEME_KEY, theme);
	} catch {
		// sem armazenamento (aba anônima etc.): o tema vale só até recarregar
	}
}
