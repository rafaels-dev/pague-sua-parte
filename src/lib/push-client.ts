"use client";

import { apiFetch } from "@/lib/api-client";

/** "ready": dá para ativar; "ios-install": iPhone fora da Tela de Início; "denied": o navegador bloqueou; "unsupported": sem suporte ou sem chave. */
export type PushSupport = "ready" | "ios-install" | "denied" | "unsupported";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(padded);
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

export function pushSupport(): PushSupport {
	if (typeof window === "undefined" || !VAPID_PUBLIC_KEY) return "unsupported";
	const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
	const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
	if (ios && !standalone) return "ios-install";
	if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return ios ? "ios-install" : "unsupported";
	return Notification.permission === "denied" ? "denied" : "ready";
}

async function registration() {
	await navigator.serviceWorker.register("/sw.js");
	return navigator.serviceWorker.ready;
}

/** Este aparelho já está inscrito? */
export async function isSubscribed(): Promise<boolean> {
	if (pushSupport() === "unsupported") return false;
	try {
		return (await (await registration()).pushManager.getSubscription()) !== null;
	} catch {
		return false;
	}
}

/** Pede permissão, inscreve este aparelho e avisa o servidor. Lança Error com texto simples se não der. */
export async function enablePush(): Promise<void> {
	if (!VAPID_PUBLIC_KEY) throw new Error("Os avisos no celular ainda não estão ligados.");
	const permission = await Notification.requestPermission();
	if (permission !== "granted") throw new Error("Os avisos não foram liberados neste celular.");
	const reg = await registration();
	const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) }));
	await apiFetch("/api/me/push", { method: "POST", body: JSON.stringify(sub.toJSON()) });
}

/** Desliga os avisos deste aparelho. */
export async function disablePush(): Promise<void> {
	const sub = await (await registration()).pushManager.getSubscription();
	if (!sub) return;
	await apiFetch("/api/me/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
	await sub.unsubscribe();
}

/** Ao sair da conta: tira a inscrição deste aparelho (melhor esforço, nunca atrapalha o "Sair"). */
export async function forgetThisDevice(): Promise<void> {
	try {
		if (pushSupport() === "unsupported" || !("serviceWorker" in navigator)) return;
		const reg = await navigator.serviceWorker.getRegistration("/sw.js");
		const sub = await reg?.pushManager.getSubscription();
		if (!sub) return;
		try {
			await Promise.race([
				apiFetch("/api/me/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }),
				new Promise((resolve) => setTimeout(resolve, 3000)),
			]);
		} finally {
			// Mesmo que o servidor não responda, o aparelho deixa de receber: um endereço que sobra no servidor é apagado no primeiro 404/410.
			await sub.unsubscribe().catch(() => undefined);
		}
	} catch {
		// segue com o "Sair"
	}
}

/**
 * Ao abrir a área logada: se o navegador já tem inscrição, reenvia ao servidor para que ela fique ligada a quem está logado AGORA.
 * Cobre a sessão que expirou sem "Sair" num aparelho compartilhado. O servidor transfere a inscrição pelo endereço (o endereço é do
 * aparelho, não da conta), por isso esta é a regra certa também quando outra pessoa entra no mesmo celular.
 */
export async function resyncSubscription(): Promise<void> {
	try {
		if (pushSupport() !== "ready" || Notification.permission !== "granted") return;
		const reg = await navigator.serviceWorker.getRegistration("/sw.js");
		const sub = await reg?.pushManager.getSubscription();
		if (sub) await apiFetch("/api/me/push", { method: "POST", body: JSON.stringify(sub.toJSON()) });
	} catch {
		// melhor esforço
	}
}
