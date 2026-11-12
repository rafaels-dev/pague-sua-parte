import { sendNotification } from "web-push";
import { isAllowedPushEndpoint } from "./endpoint";
import type { Notice } from "./types";
import type { PushSubscriptionDoc } from "./subscriptions";

export function pushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** Corpo pequeno: título, texto e endereço relativo. */
export const pushPayload = (n: Pick<Notice, "title" | "body" | "url">) => JSON.stringify({ title: n.title, body: n.body, url: n.url });

/** Envia a um aparelho. Devolve `"gone"` quando o serviço diz que a inscrição não existe mais (404/410). */
export async function sendPush(sub: Pick<PushSubscriptionDoc, "endpoint" | "keys">, notice: Notice, env: NodeJS.ProcessEnv = process.env): Promise<"sent" | "gone" | "skipped"> {
	if (!pushConfigured(env)) return "skipped";
	// Inscrição antiga ou adulterada fora da lista de serviços conhecidos: nunca é chamada (quem chama apaga).
	if (!isAllowedPushEndpoint(sub.endpoint)) return "gone";
	try {
		await sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, pushPayload(notice), {
			vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
			TTL: 24 * 60 * 60,
			timeout: 8000,
		});
		return "sent";
	} catch (err) {
		const status = (err as { statusCode?: number }).statusCode;
		if (status === 404 || status === 410) return "gone";
		// Sem o endereço do serviço de push no erro: só o código.
		throw new Error(`Falha no push${status ? ` (${status})` : ""}`);
	}
}
