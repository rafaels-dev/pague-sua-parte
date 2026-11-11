/** Título da barra superior, destino de "voltar" e item de navegação ativo para cada rota do app. */
export type ScreenInfo = { title: string; back: string | null; nav: string };

export function screenInfo(pathname: string): ScreenInfo {
	if (pathname === "/app/perfil" || pathname.startsWith("/app/perfil/")) {
		return { title: "Meu perfil", back: null, nav: "/app/perfil" };
	}
	if (pathname === "/app/grupos/novo") return { title: "Criar grupo", back: "/app", nav: "/app" };
	const expense = /^\/app\/grupos\/([^/]+)\/despesas\/([^/]+)$/.exec(pathname);
	if (expense) {
		if (expense[2] === "nova") return { title: "Lançar despesa", back: `/app/grupos/${expense[1]}`, nav: "/app" };
		return { title: "Despesa", back: `/app/grupos/${expense[1]}`, nav: "/app" };
	}
	if (pathname.startsWith("/app/grupos/")) return { title: "Grupo", back: "/app", nav: "/app" };
	return { title: "Pague Sua Parte", back: null, nav: "/app" };
}
