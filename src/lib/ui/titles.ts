import { groupParam } from "./group-scope";

/** Título da barra superior, destino de "voltar" e item de navegação ativo para cada rota do app. */
export type ScreenInfo = { title: string; back: string | null; nav: string };

export function screenInfo(pathname: string, search = ""): ScreenInfo {
	// "Pagar tudo" e "Quem me deve" abertos a partir de um grupo (?grupo=<id>) voltam para ele, não para o início.
	const group = pathname === "/app/pagar" || pathname === "/app/receber" ? groupParam(search) : null;
	const backHome = group ? `/app/grupos/${group}` : "/app";
	if (pathname === "/app/perfil" || pathname.startsWith("/app/perfil/")) {
		return { title: "Meu perfil", back: null, nav: "/app/perfil" };
	}
	if (pathname === "/app/avisos") return { title: "Avisos", back: "/app", nav: "/app" };
	if (pathname === "/app/pagar") return { title: "Pagar tudo", back: backHome, nav: "/app" };
	if (pathname === "/app/receber") return { title: "Quem me deve", back: backHome, nav: "/app" };
	if (pathname === "/app/grupos/novo") return { title: "Criar grupo", back: "/app", nav: "/app" };
	const report = /^\/app\/grupos\/([^/]+)\/relatorio$/.exec(pathname);
	if (report) return { title: "Relatório", back: `/app/grupos/${report[1]}`, nav: "/app" };
	const editing = /^\/app\/grupos\/([^/]+)\/despesas\/([^/]+)\/editar$/.exec(pathname);
	if (editing) return { title: "Editar despesa", back: `/app/grupos/${editing[1]}/despesas/${editing[2]}`, nav: "/app" };
	const expense = /^\/app\/grupos\/([^/]+)\/despesas\/([^/]+)$/.exec(pathname);
	if (expense) {
		if (expense[2] === "nova") return { title: "Lançar despesa", back: `/app/grupos/${expense[1]}`, nav: "/app" };
		return { title: "Despesa", back: `/app/grupos/${expense[1]}`, nav: "/app" };
	}
	if (pathname.startsWith("/app/grupos/")) return { title: "Grupo", back: "/app", nav: "/app" };
	return { title: "PagueSuaParte", back: null, nav: "/app" };
}
