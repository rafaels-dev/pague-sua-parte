"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { canFetchCount } from "@/lib/ui/inbox";

/** Intervalo mínimo entre duas buscas do contador (sem polling: só ao carregar, ao trocar de tela e quando a aba volta). */
export const MIN_COUNT_INTERVAL_MS = 60_000;

type InboxState = { unseen: number; clear: () => void };
const InboxContext = createContext<InboxState>({ unseen: 0, clear: () => {} });

/** Contador "não vistos" do sininho. Falha na busca = silêncio. */
export function InboxProvider({ enabled, children }: Readonly<{ enabled: boolean; children: React.ReactNode }>) {
	const [unseen, setUnseen] = useState(0);
	const pathname = usePathname();
	const last = useRef(0);
	const inflight = useRef(false);
	const epoch = useRef(0);

	const fetchCount = useCallback(() => {
		if (inflight.current || !canFetchCount(Date.now(), last.current, MIN_COUNT_INTERVAL_MS)) return;
		inflight.current = true;
		last.current = Date.now();
		const mine = epoch.current;
		apiFetch<{ unseen: number }>("/api/me/inbox/count")
			.then((r) => {
				// Se a pessoa abriu a lista enquanto a busca voltava, o zero vale mais.
				if (mine === epoch.current && typeof r.unseen === "number") setUnseen(r.unseen);
			})
			.catch(() => undefined)
			.finally(() => {
				inflight.current = false;
			});
	}, []);

	const reset = useCallback(() => {
		epoch.current++;
		last.current = 0;
		setUnseen(0);
	}, []);

	// Ao entrar e a cada troca de tela (respeitando o intervalo mínimo).
	useEffect(() => {
		if (enabled) fetchCount();
	}, [enabled, pathname, fetchCount]);

	useEffect(() => {
		if (!enabled) return;
		const onVisible = () => {
			if (document.visibilityState === "visible") fetchCount();
		};
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onVisible);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onVisible);
			// Saiu da conta ou trocou de pessoa: nada do contador anterior sobrevive.
			reset();
		};
	}, [enabled, fetchCount, reset]);

	// Zerar ao abrir a página NÃO mexe no intervalo: a próxima busca permitida mostra o que chegou depois.
	const clear = useCallback(() => {
		epoch.current++;
		setUnseen(0);
	}, []);

	const value = useMemo(() => ({ unseen, clear }), [unseen, clear]);
	return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export const useInbox = () => useContext(InboxContext);
