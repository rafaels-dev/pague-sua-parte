/**
 * `?groupId=<id>` das rotas `/api/me/*`: ausente = sem filtro (`undefined`); presente = o texto, para o repo conferir
 * (inválido ou de um grupo de que a pessoa não faz parte vira 404 "Grupo não encontrado.").
 */
export function groupIdParam(request: Request): string | undefined {
	const raw = new URL(request.url).searchParams.get("groupId");
	return raw === null ? undefined : raw;
}
