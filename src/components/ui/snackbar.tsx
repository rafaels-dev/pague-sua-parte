"use client";

import { useEffect, useRef } from "react";

/**
 * Confirmação breve. Usa a camada superior (popover) para aparecer inclusive sobre um Sheet aberto.
 * O texto também vai para uma região "status" invisível, para leitores de tela.
 */
export function Snackbar({
	open,
	message,
	onClose,
	duration = 4000,
	aboveNav = false,
}: Readonly<{ open: boolean; message: string; onClose: () => void; duration?: number; aboveNav?: boolean }>) {
	const ref = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	useEffect(() => {
		closeRef.current = onClose;
	});

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		try {
			const shown = el.matches(":popover-open");
			if (open && !shown) el.showPopover();
			else if (!open && shown) el.hidePopover();
		} catch {
			// Navegador sem popover: a região "status" abaixo ainda avisa quem usa leitor de tela.
		}
		if (!open) return;
		const t = setTimeout(() => closeRef.current(), duration);
		return () => clearTimeout(t);
	}, [open, message, duration]);

	return (
		<>
			<p role="status" className="sr-only">
				{open ? message : ""}
			</p>
			<div
				ref={ref}
				popover="manual"
				aria-hidden="true"
				className={`fixed inset-auto left-4 right-4 m-0 w-auto max-w-none overflow-visible border-0 bg-transparent p-0 md:left-6 md:right-auto md:bottom-6 md:w-96 ${
					aboveNav ? "bottom-[calc(5rem+env(safe-area-inset-bottom)+0.75rem)]" : "bottom-4"
				}`}
			>
				<div className="flex min-h-12 items-center rounded-shape-sm bg-inverse-surface px-4 py-3 text-body-large text-inverse-on-surface shadow-elevation-3 [animation:fade-in_150ms_ease-out]">
					{message}
				</div>
			</div>
		</>
	);
}
