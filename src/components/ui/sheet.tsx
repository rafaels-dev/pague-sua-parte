"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Sheet modal sobre <dialog> nativo (foco preso, Esc e fundo escurecido de graça).
 * Celular: folha inferior. Telas largas: diálogo centralizado.
 */
export function Sheet({
	open,
	onClose,
	title,
	children,
	tall = false,
}: Readonly<{
	open: boolean;
	onClose: () => void;
	title: string;
	children: React.ReactNode;
	/** Celular: ocupa a tela toda (listas longas, formulários). Telas largas: diálogo um pouco mais largo. */
	tall?: boolean;
}>) {
	const ref = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const titleRef = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// Foco inicial no título: sem anel de foco em botão quando se abre por toque.
			titleRef.current?.focus({ preventScroll: true });
		}
		else if (!open && dialog.open) dialog.close();
	}, [open]);

	return (
		<dialog
			ref={ref}
			aria-labelledby={titleId}
			onClose={onClose}
			onClick={(e) => {
				// Clique no fundo escurecido (o próprio <dialog>) fecha.
				if (e.target === e.currentTarget) onClose();
			}}
			className={`fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-b-none rounded-t-shape-lg bg-surface-container-low p-0 text-on-surface shadow-elevation-3 open:[animation:sheet-up_200ms_cubic-bezier(0.2,0,0,1)] md:inset-0 md:m-auto md:h-fit md:max-h-[90dvh] md:rounded-shape-lg md:open:[animation:dialog-in_200ms_cubic-bezier(0.2,0,0,1)] ${
				tall ? "max-md:top-0 max-md:h-dvh max-md:max-h-none max-md:rounded-none md:max-w-xl" : "md:max-w-md"
			}`}
		>
			<div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 md:pt-6">
				<div aria-hidden="true" className="mx-auto mb-4 h-1 w-8 rounded-full bg-on-surface-variant/40 md:hidden" />
				<h2 ref={titleRef} id={titleId} tabIndex={-1} className="mb-4 text-headline-small outline-none">
					{title}
				</h2>
				{children}
			</div>
		</dialog>
	);
}
