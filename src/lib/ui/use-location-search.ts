import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
	window.addEventListener("popstate", onChange);
	return () => window.removeEventListener("popstate", onChange);
};

/**
 * A query string do endereço ("?grupo=…"), lida no navegador. `null` até o navegador ler (no servidor e na hidratação).
 * Alternativa a `useSearchParams`, que obrigaria a envolver a tela em Suspense (mesmo padrão de `?voltar=` do início).
 */
export function useLocationSearch(): string | null {
	return useSyncExternalStore(subscribe, () => window.location.search, () => null);
}
