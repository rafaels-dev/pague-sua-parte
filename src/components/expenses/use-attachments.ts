"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clipboardFileName, filesFromTransfer, pickClipboardType } from "@/lib/ui/clipboard-files";
import { MAX_FILES, countProblem, effectiveType, isImageType, sizeProblem, totalProblem, typeProblem } from "@/lib/ui/attachments";
import { downscaleImage } from "@/lib/ui/image-downscale";

export type PickedFile = {
	id: string;
	file: File;
	kind: "image" | "pdf";
	/** URL de pré-visualização (só imagens); revogada ao remover ou sair da tela. */
	previewUrl: string | null;
};

const subscribeNever = () => () => {};

const PASTE_DENIED =
	"Seu aparelho não deixou colar daqui. Toque e segure no campo de texto e escolha Colar, ou use Ctrl+V no computador.";

/**
 * Anexos da tela de nova despesa: escolher arquivos, colar (Ctrl+V na tela toda e botão "Colar print") e arrastar e soltar.
 * Com `maxFiles: 1` (comprovante), escolher outro arquivo troca o atual. Imagens grandes são reduzidas antes de entrar na lista. Mensagens de problema ficam em `problems`.
 */
export function useAttachments({ enabled = true, maxFiles = MAX_FILES }: { enabled?: boolean; maxFiles?: number } = {}) {
	const [items, setItems] = useState<PickedFile[]>([]);
	const [problems, setProblems] = useState<string[]>([]);
	const [processing, setProcessing] = useState(false);
	const [dragging, setDragging] = useState(false);

	const itemsRef = useRef<PickedFile[]>([]);
	const queue = useRef<Promise<void>>(Promise.resolve());
	const seq = useRef(0);
	const pasteCount = useRef(0);
	const pending = useRef(0);

	const commit = useCallback((next: PickedFile[]) => {
		itemsRef.current = next;
		setItems(next);
	}, []);

	// Só existe no navegador; no servidor (e na hidratação) o botão "Colar print" fica escondido.
	const canReadClipboard = useSyncExternalStore(
		subscribeNever,
		() => typeof navigator.clipboard?.read === "function",
		() => false,
	);

	// Revoga as URLs de pré-visualização ao sair da tela.
	useEffect(() => {
		return () => {
			for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
		};
	}, []);

	const addFiles = useCallback(
		(incoming: File[]) => {
			if (incoming.length === 0) return;
			pending.current++;
			setProcessing(true);
			queue.current = queue.current.then(async () => {
				const msgs: string[] = [];
				let current = itemsRef.current;
				let tooMany = false;
				for (const original of incoming) {
					const full = maxFiles === 1 ? null : countProblem(current.length, maxFiles);
					if (full) {
						tooMany = true;
						continue;
					}
					const bad = typeProblem(original);
					if (bad) {
						msgs.push(bad);
						continue;
					}
					// Arquivos sem tipo declarado (alguns celulares) ganham o tipo deduzido pela extensão.
					const typed = original.type ? original : new File([original], original.name, { type: effectiveType(original) });
					const file = isImageType(effectiveType(typed)) ? await downscaleImage(typed) : typed;
					const big = sizeProblem(file);
					if (big) {
						msgs.push(big);
						continue;
					}
					// Com um arquivo só, o novo substitui o atual; senão, a soma de todos precisa caber em 4 MB.
					const keptBytes = maxFiles === 1 ? 0 : current.reduce((sum, it) => sum + it.file.size, 0);
					const tooBig = totalProblem(keptBytes, file);
					if (tooBig) {
						msgs.push(tooBig);
						continue;
					}
					const image = isImageType(effectiveType(file));
					if (maxFiles === 1) {
						// Um arquivo só: o novo substitui o anterior.
						for (const old of current) if (old.previewUrl) URL.revokeObjectURL(old.previewUrl);
						current = [];
					}
					current = [
						...current,
						{ id: `a${++seq.current}`, file, kind: image ? "image" : "pdf", previewUrl: image ? URL.createObjectURL(file) : null },
					];
					commit(current);
				}
				if (tooMany) msgs.push(countProblem(maxFiles, maxFiles)!);
				setProblems(msgs);
			});
			queue.current = queue.current.catch(() => {}).finally(() => {
				if (--pending.current === 0) setProcessing(false);
			});
		},
		[commit, maxFiles],
	);

	const remove = useCallback(
		(id: string) => {
			const gone = itemsRef.current.find((i) => i.id === id);
			if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
			commit(itemsRef.current.filter((i) => i.id !== id));
			setProblems([]);
		},
		[commit],
	);

	/** Botão "Colar print": lê a imagem da área de transferência (onde o navegador permite). */
	const pasteFromClipboard = useCallback(async () => {
		try {
			const clipItems = await navigator.clipboard.read();
			const files: File[] = [];
			for (const ci of clipItems) {
				const type = pickClipboardType(ci.types);
				if (!type) continue;
				const blob = await ci.getType(type);
				files.push(new File([blob], clipboardFileName(type, ++pasteCount.current), { type }));
			}
			if (files.length === 0) {
				setProblems(["Não encontrei nenhum print copiado. Copie a imagem primeiro e toque em Colar print de novo."]);
				return;
			}
			addFiles(files);
		} catch {
			setProblems([PASTE_DENIED]);
		}
	}, [addFiles]);

	// Colar (Ctrl+V ou "Colar" no menu do celular) em qualquer lugar da tela, inclusive dentro de um campo de texto.
	useEffect(() => {
		if (!enabled) return;
		const onPaste = (e: ClipboardEvent) => {
			const files = filesFromTransfer(e.clipboardData);
			if (files.length === 0) return; // texto puro: colagem normal
			e.preventDefault();
			addFiles(files);
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [enabled, addFiles]);

	// Arrastar e soltar (telas largas), com destaque enquanto o arquivo está sobre a tela.
	useEffect(() => {
		if (!enabled) return;
		let depth = 0;
		const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
		const onEnter = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			depth++;
			setDragging(true);
		};
		const onOver = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault(); // sem isto o navegador abriria o arquivo em vez de soltar
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
		};
		const onLeave = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDragging(false);
		};
		const onDrop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			depth = 0;
			setDragging(false);
			addFiles(filesFromTransfer(e.dataTransfer));
		};
		window.addEventListener("dragenter", onEnter);
		window.addEventListener("dragover", onOver);
		window.addEventListener("dragleave", onLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onEnter);
			window.removeEventListener("dragover", onOver);
			window.removeEventListener("dragleave", onLeave);
			window.removeEventListener("drop", onDrop);
		};
	}, [enabled, addFiles]);

	return { items, problems, processing, dragging, canReadClipboard, addFiles, remove, pasteFromClipboard, clearProblems: () => setProblems([]) };
}
