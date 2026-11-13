"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Snackbar } from "@/components/ui";
import { InboxView } from "@/components/inbox/inbox-view";
import { useInbox } from "@/components/inbox/inbox-context";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { InboxItem } from "@/lib/ui/inbox";

export default function AvisosPage() {
	const { user } = useAuth();
	const { clear } = useInbox();
	const [status, setStatus] = useState<"loading" | "error" | "ready">(
		"loading",
	);
	const [items, setItems] = useState<InboxItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const itemsRef = useRef<InboxItem[]>([]);
	useEffect(() => {
		itemsRef.current = items;
	});
	const [markError, setMarkError] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);
	const [now, setNow] = useState(() => new Date());
	const uid = user?.uid;

	useEffect(() => {
		if (!uid) return;
		let cancelled = false;
		apiFetch<{ items: InboxItem[]; seenUpTo?: string }>("/api/me/inbox")
			.then((r) => {
				if (cancelled) return;
				setItems(r.items);
				setNow(new Date());
				setStatus("ready");
				// Abriu a lista: tudo o que chegou até agora conta como visto (o destaque de cada linha segue pelo "lido").
				apiFetch("/api/me/inbox/seen", {
					method: "POST",
					body: r.seenUpTo ? JSON.stringify({ upTo: r.seenUpTo }) : undefined,
				}).catch(() => undefined);
				clear();
			})
			.catch((e) => {
				if (cancelled) return;
				setError(
					e instanceof ApiError
						? e.message
						: "Não foi possível carregar seus avisos.",
				);
				setStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [uid, reloadKey, clear]);

	const onOpen = useCallback((item: InboxItem) => {
		if (item.read) return;
		setItems((cur) =>
			cur.map((i) => (i.id === item.id ? { ...i, read: true } : i)),
		);
		apiFetch("/api/me/inbox/read", {
			method: "POST",
			body: JSON.stringify({ id: item.id }),
		}).catch(() => undefined);
	}, []);

	const onMarkAllRead = useCallback(() => {
		const before = itemsRef.current; // fora do updater: ele roda duas vezes no StrictMode
		setItems((cur) => cur.map((i) => ({ ...i, read: true })));
		apiFetch("/api/me/inbox/read", {
			method: "POST",
			body: JSON.stringify({ all: true }),
		}).catch(() => {
			// Não deu: volta ao que era (só o que ainda estava não lido) e avisa.
			const unread = new Set(before.filter((i) => !i.read).map((i) => i.id));
			setItems((cur) =>
				cur.map((i) => (unread.has(i.id) ? { ...i, read: false } : i)),
			);
			setMarkError(true);
		});
	}, []);

	return (
		<>
			<InboxView
				status={status}
				items={items}
				error={error}
				now={now}
				onRetry={() => {
					setStatus("loading");
					setError(null);
					setReloadKey((k) => k + 1);
				}}
				onOpen={onOpen}
				onMarkAllRead={onMarkAllRead}
			/>
			<Snackbar
				open={markError}
				message="Não deu para marcar como lidas. Tente de novo."
				onClose={() => setMarkError(false)}
				aboveNav
			/>
		</>
	);
}
