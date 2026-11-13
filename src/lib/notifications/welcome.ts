import { getDb } from "@/lib/db/client";
import type { Db } from "mongodb";
import type { AuthUser } from "@/lib/auth/server";
import { upsertFromAuth, type UserDoc } from "@/lib/users/repo";
import { oneLine } from "./email-content";
import { runAfterResponse } from "./schedule";
import type { Notice } from "./types";

/** Primeiro nome para cumprimentar (apelido do perfil, senão o nome do Google); vazio se não houver. */
export function firstName(user: { name?: string; displayName?: string }): string {
	const full = oneLine(user.displayName?.trim() || user.name?.trim() || "");
	const first = full.split(" ")[0] ?? "";
	return first.length > 30 ? first.slice(0, 30) : first;
}

/** Boas-vindas: só e-mail, uma vez por conta. Sem chave Pix, sem dados de grupo. */
export function buildWelcomeNotice(user: { uid: string; name?: string; displayName?: string }): Notice {
	const name = firstName(user);
	return {
		uid: user.uid,
		title: name ? `Que bom ter você aqui, ${name}` : "Que bom ter você aqui",
		body: "No PagueSuaParte, dividir as contas do grupo fica simples. Veja o que dá para fazer:",
		list: ["Dividir despesas com a família e os amigos, sem planilha.", "Pagar a sua parte por Pix copia e cola.", "Guardar os comprovantes num só lugar."],
		next: "Para começar, cadastre sua chave Pix no perfil. Assim os outros conseguem pagar você.",
		url: "/app",
		scope: { kind: "account", name: "PagueSuaParte" },
		emailOnly: true,
	};
}

/** Depois da resposta, avisa o e-mail da conta recém-criada (respeita e-mail confirmado e a preferência, como os outros avisos). */
export const afterWelcome = (user: { uid: string; name?: string; displayName?: string }) =>
	runAfterResponse(async () => {
		const { notify } = await import("./notify"); // sob demanda: rotas de login não carregam o canal de avisos sem precisar
		await notify(await getDb(), [buildWelcomeNotice(user)]);
	});

/**
 * O ponto único das boas-vindas: grava/atualiza a conta e, só se este pedido INSERIU a conta (atômico, pelo resultado do upsert),
 * agenda o e-mail. Rotas de login usam esta função; um script que use `upsertFromAuth` direto nunca manda e-mail.
 */
export async function upsertAndWelcome(db: Db, authUser: AuthUser): Promise<UserDoc> {
	const { user, created } = await upsertFromAuth(db, authUser);
	if (created) afterWelcome({ uid: user._id, name: user.name, displayName: user.displayName });
	return user;
}
