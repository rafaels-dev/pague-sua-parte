"use client";

import { useId, useRef } from "react";
import { Button, Icon, IconButton } from "@/components/ui";
import { ACCEPT_ATTR, IMAGE_ACCEPT_ATTR, MAX_FILES, formatFileSize } from "@/lib/ui/attachments";
import { cx } from "@/lib/ui/cx";
import type { PickedFile } from "./use-attachments";

/** Área de anexos da nova despesa: botões (escolher, colar), lista com miniaturas e destaque ao arrastar. */
export function AttachmentPicker({
	items,
	problems,
	serverError,
	processing,
	dragging,
	canPaste,
	disabled,
	onPick,
	onRemove,
	onPaste,
	maxFiles = MAX_FILES,
	copy,
	imagesOnly = false,
}: Readonly<{
	items: PickedFile[];
	problems: string[];
	serverError?: string | null;
	processing: boolean;
	dragging: boolean;
	canPaste: boolean;
	disabled?: boolean;
	onPick: (files: File[]) => void;
	onRemove: (id: string) => void;
	onPaste: () => void;
	/** 1 = um arquivo só (comprovante): o botão de escolher passa a trocar o arquivo. */
	maxFiles?: number;
	/** Textos (padrão: anexos da despesa). */
	/** Só fotos (JPG, PNG, WebP): fotos do plano. */
	imagesOnly?: boolean;
	copy?: { title: string; optional: boolean; hint: string; pick: string; pickAgain: string; inputLabel: string };
}>) {
	const input = useRef<HTMLInputElement>(null);
	const single = maxFiles === 1;
	const full = !single && items.length >= maxFiles;
	const titleId = useId();
	const texts = copy ?? {
		title: "Anexos",
		optional: true,
		hint: `Foto, print ou PDF da nota. Até ${maxFiles} arquivos, 4 MB no total.`,
		pick: "Anexar foto ou PDF",
		pickAgain: "Anexar foto ou PDF",
		inputLabel: "Escolher arquivos para anexar",
	};
	const messages = [...problems, ...(serverError ? [serverError] : [])];

	return (
		<section
			aria-labelledby={titleId}
			className={cx(
				"space-y-3 rounded-shape-lg border-2 border-dashed p-4 transition-colors duration-150",
				dragging ? "border-primary bg-primary-container/40" : "border-outline-variant",
			)}
		>
			<div>
				<h2 id={titleId} className="text-title-medium">
					{texts.title} {texts.optional && <span className="font-normal text-on-surface-variant">(opcional)</span>}
				</h2>
				<p className="text-body-large text-on-surface-variant">
					{dragging ? "Solte aqui para anexar." : texts.hint}
				</p>
			</div>

			{items.length > 0 && (
				<ul className="space-y-2">
					{items.map((it) => (
						<li key={it.id} className="flex items-center gap-3 rounded-shape-md bg-surface-container-low p-2 pr-1">
							{it.previewUrl ? (
								// eslint-disable-next-line @next/next/no-img-element
								<img src={it.previewUrl} alt="" className="size-14 shrink-0 rounded-shape-sm bg-surface-container-high object-cover" />
							) : (
								<span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-shape-sm bg-error-container text-on-error-container">
									<Icon name="description" />
									<span className="text-xs font-bold leading-none">PDF</span>
								</span>
							)}
							<span className="min-w-0 flex-1">
								<span className="block truncate text-body-large font-medium">{it.file.name}</span>
								<span className="block text-body-large text-on-surface-variant">{formatFileSize(it.file.size)}</span>
							</span>
							<IconButton icon="close" label={`Remover ${it.file.name}`} onClick={() => onRemove(it.id)} />
						</li>
					))}
				</ul>
			)}

			{processing && (
				<p role="status" className="text-body-large text-on-surface-variant">
					Preparando o arquivo...
				</p>
			)}

			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
				<Button
					variant="tonal"
					icon="attach_file"
					size="md"
					disabled={disabled || full}
					onClick={() => input.current?.click()}
					className="sm:flex-1 sm:basis-0"
				>
					{single && items.length > 0 ? texts.pickAgain : texts.pick}
				</Button>
				{canPaste && (
					<Button variant="outlined" icon="content_paste" size="md" disabled={disabled || full} onClick={onPaste} className="sm:flex-1 sm:basis-0">
						Colar print
					</Button>
				)}
				<input
					ref={input}
					type="file"
					accept={imagesOnly ? IMAGE_ACCEPT_ATTR : ACCEPT_ATTR}
					multiple={!single}
					tabIndex={-1}
					className="sr-only"
					aria-label={texts.inputLabel}
					onChange={(e) => {
						const files = Array.from(e.target.files ?? []);
						e.target.value = ""; // permite escolher o mesmo arquivo de novo
						onPick(files);
					}}
				/>
			</div>

			<p className="text-body-large text-on-surface-variant">
				<span className="md:hidden">Também dá para tocar e segurar num campo de texto e escolher Colar.</span>
				<span className="max-md:hidden">Também dá para apertar Ctrl+V com um print copiado, ou arrastar o arquivo para esta tela.</span>
			</p>

			{messages.length > 0 && (
				<ul role="alert" className="space-y-1 text-body-large text-error">
					{messages.map((m) => (
						<li key={m} className="flex gap-2">
							<Icon name="error" size={20} className="mt-0.5" />
							<span>{m}</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
