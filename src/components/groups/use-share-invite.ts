"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { normalizeGroupDetail } from "@/components/groups/types";
import type { Group } from "@/components/groups/group-detail";

export type ShareInvite = {
	/** "loading" enquanto busca; "ready" quando respondeu, falhou ou passou o tempo (então `token` é null e o texto leva o link simples). */
	status: "idle" | "loading" | "ready";
	token: string | null;
	/** Só uma pessoa com login no grupo (quem compartilha); pessoas cuidadas não contam. Null se não se sabe. */
	solo: boolean | null;
};

/** Depois disso o sheet segue com o link simples, para nunca ficar preso em "Preparando a mensagem...". */
export const SHARE_INVITE_TIMEOUT_MS = 5000;

/**
 * Enquanto `active`, obtém o convite do grupo (o servidor reaproveita o convite válido; qualquer membro pode pedir)
 * para o link dos textos compartilhados e, se `knownSolo` não vier, quantas pessoas com login há no grupo.
 * Cada abertura começa do zero (nada de token da vez anterior); falha ou demora nunca trava nem fica gravada.
 */
export function useShareInvite(groupId: string, active: boolean, knownSolo?: boolean): ShareInvite {
	const [done, setDone] = useState<{ token: string | null; solo: boolean | null } | null>(null);
	// `knownSolo` pode mudar durante a abertura sem disparar outro POST.
	const known = useRef(knownSolo);
	useEffect(() => {
		known.current = knownSolo;
	});

	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		const gid = encodeURIComponent(groupId);
		const invite = apiFetch<{ token?: string }>(`/api/groups/${gid}/invite`, { method: "POST", body: JSON.stringify({}) })
			.then((r) => (typeof r.token === "string" && r.token ? r.token : null))
			.catch(() => null);
		const solo: Promise<boolean | null> =
			known.current !== undefined
				? Promise.resolve(known.current)
				: apiFetch<Group>(`/api/groups/${gid}`)
						.then((g) => normalizeGroupDetail(g).members.filter((m) => m.kind === "user").length <= 1)
						.catch(() => null);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<{ token: null; solo: null }>((resolve) => {
			timer = setTimeout(() => resolve({ token: null, solo: null }), SHARE_INVITE_TIMEOUT_MS);
		});
		const both = Promise.all([invite, solo]).then(([token, isSolo]) => ({ token, solo: isSolo }));
		void Promise.race([both, timeout]).then((r) => {
			clearTimeout(timer);
			if (!cancelled) setDone(r);
		});
		return () => {
			cancelled = true;
			clearTimeout(timer);
			setDone(null);
		};
	}, [groupId, active]);

	if (done && active) return { status: "ready", ...done };
	return { status: active ? "loading" : "idle", token: null, solo: null };
}
