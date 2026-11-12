"use client";

import { Icon } from "@/components/ui";
import { formatFileSize, isImageType } from "@/lib/ui/attachments";
import type { ExpenseAttachment } from "./types";

export type AttachmentView = ExpenseAttachment & {
	/** Endereço local (blob) da imagem, quando já carregou. */
	url: string | null;
	state: "loading" | "ready" | "error";
};

/** Anexos da despesa: miniaturas de imagem (toque para ampliar) e chips de PDF (abre em outra aba). */
export function ExpenseAttachments({
	items,
	onOpenImage,
	onOpenPdf,
	title = "Anexos",
}: Readonly<{ items: AttachmentView[]; onOpenImage: (id: string) => void; onOpenPdf: (id: string) => void; title?: string }>) {
	if (items.length === 0) return null;
	return (
		<section className="space-y-3" aria-labelledby="anexos-despesa">
			<h2 id="anexos-despesa" className="text-title-large">
				{title}
			</h2>
			<ul className="flex flex-wrap gap-3">
				{items.map((a) => {
					const image = isImageType(a.contentType);
					return (
						<li key={a.id}>
							{image ? (
								<button
									type="button"
									onClick={() => onOpenImage(a.id)}
									disabled={a.state !== "ready"}
									aria-label={`Ampliar ${a.name}`}
									className="state-layer relative block size-28 overflow-hidden rounded-shape-md bg-surface-container-high md:size-32"
								>
									{a.url ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img src={a.url} alt="" className="size-full object-cover" />
									) : (
										<span className="flex size-full items-center justify-center text-on-surface-variant">
											<Icon name="image" size={32} />
										</span>
									)}
									{a.state === "error" && (
										<span className="absolute inset-x-0 bottom-0 bg-error-container px-1 py-0.5 text-center text-xs text-on-error-container">
											Não abriu
										</span>
									)}
								</button>
							) : (
								<button
									type="button"
									onClick={() => onOpenPdf(a.id)}
									className="state-layer flex min-h-14 max-w-64 items-center gap-3 rounded-shape-md bg-error-container py-2 pl-3 pr-4 text-left text-on-error-container"
								>
									<Icon name="description" />
									<span className="min-w-0">
										<span className="block truncate text-label-large">{a.name}</span>
										<span className="block text-sm">PDF · {formatFileSize(a.size)} · abrir</span>
									</span>
								</button>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
