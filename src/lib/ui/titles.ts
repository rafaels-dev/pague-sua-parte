/** Título da barra superior, destino de "voltar" e item de navegação ativo para cada rota do app. */
export type ScreenInfo = { title: string; back: string | null; nav: string };

export function screenInfo(pathname: string): ScreenInfo {
	if (pathname === "/app/perfil" || pathname.startsWith("/app/perfil/")) {
		return { title: "Meu perfil", back: null, nav: "/app/perfil" };
	}
	if (pathname === "/app/grupos/novo") return { title: "Criar grupo", back: "/app", nav: "/app" };
	if (pathname.startsWith("/app/grupos/")) return { title: "Grupo", back: "/app", nav: "/app" };
	return { title: "Racha Pix", back: null, nav: "/app" };
}
