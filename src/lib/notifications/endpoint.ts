const EXACT_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const SUFFIX_HOSTS = [".notify.windows.com", ".push.apple.com"];

/**
 * O endereço de inscrição é de um serviço de push conhecido? O servidor faz uma chamada a ele, então só entra https, sem usuário/senha,
 * sem porta diferente da padrão e com host exato (FCM, Mozilla) ou sufixo com ponto (Windows, Apple). Evita que um cliente aponte o
 * servidor para endereços internos (SSRF).
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
	const host = url.hostname.toLowerCase();
	return EXACT_HOSTS.has(host) || SUFFIX_HOSTS.some((s) => host.endsWith(s) && host.length > s.length);
}
