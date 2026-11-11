/** Prints costumam vir em PNG; é o formato preferido. */
const PREFERENCE = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

type ItemLike = { kind: string; type: string; getAsFile(): File | null };
type DataLike = { files?: ArrayLike<File> | null; items?: ArrayLike<ItemLike> | null };

/**
 * Arquivos de um evento "paste" ou "drop": usa `files` e, se vier vazio, os itens do tipo arquivo.
 * Texto puro devolve lista vazia (e então a colagem segue normal).
 */
export function filesFromTransfer(data: DataLike | null | undefined): File[] {
	if (!data) return [];
	const direct = data.files ? Array.from(data.files) : [];
	if (direct.length > 0) return direct;
	const out: File[] = [];
	for (const item of data.items ? Array.from(data.items) : []) {
		if (item.kind !== "file") continue;
		const f = item.getAsFile();
		if (f) out.push(f);
	}
	return out;
}

/** O que há na área de transferência (API assíncrona): escolhe o primeiro tipo que aceitamos, preferindo imagem. */
export function pickClipboardType(types: readonly string[]): string | null {
	const lower = types.map((t) => t.toLowerCase());
	for (const t of PREFERENCE) if (lower.includes(t)) return t;
	return null;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Nome para um arquivo colado: "print-1.png". */
export function clipboardFileName(type: string, n: number): string {
	return `print-${n}.${EXT[type] ?? "png"}`;
}
