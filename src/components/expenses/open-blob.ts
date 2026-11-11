/**
 * Abre um arquivo (PDF) numa nova aba. A aba é aberta já no toque (senão o navegador bloqueia) e só depois recebe o arquivo.
 * `track` guarda o endereço local criado, para ser revogado ao sair da tela. Lança o erro de `load` (a aba é fechada).
 */
export async function openBlobInNewTab(load: () => Promise<Blob>, fallbackName: string, track: (url: string) => void): Promise<void> {
	const tab = window.open("", "_blank");
	try {
		const blob = await load();
		const url = URL.createObjectURL(blob);
		track(url);
		if (tab) {
			tab.opener = null;
			tab.location.href = url;
		} else {
			const a = document.createElement("a");
			a.href = url;
			a.download = fallbackName;
			a.click();
		}
	} catch (e) {
		tab?.close();
		throw e;
	}
}
