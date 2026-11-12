/** Regras dos anexos de uma despesa (as mesmas do servidor) e decisões puras sobre eles. */

export const MAX_FILES = 3;
/** Mesmos limites do servidor: a Vercel recusa requisições acima de 4,5 MB, então os anexos somam no máximo 4 MB. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
export const IMAGE_ACCEPT_ATTR = "image/jpeg,image/png,image/webp";

/** Imagens maiores que isto (em pixels, lado maior) ou em bytes são reduzidas antes do envio. */
export const MAX_SIDE = 1600;
export const SMALL_ENOUGH_BYTES = 1.5 * 1024 * 1024;
export const JPEG_QUALITY = 0.8;

export type FileLike = { name: string; type: string; size: number };

const EXT_TYPES: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	pdf: "application/pdf",
};

/** Tipo efetivo: o declarado ou, se vier vazio (acontece em alguns celulares), o deduzido pela extensão. */
export function effectiveType(file: FileLike): string {
	if (file.type) return file.type.toLowerCase();
	const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
	return (ext && EXT_TYPES[ext]) || "";
}

export function isImageType(type: string): boolean {
	return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function shortName(name: string): string {
	const clean = name.trim() || "arquivo";
	return clean.length > 28 ? `${clean.slice(0, 25)}...` : clean;
}

/** Mensagem se o tipo não é aceito; null se está tudo bem. */
export function typeProblem(file: FileLike): string | null {
	return ACCEPTED_TYPES.includes(effectiveType(file) as (typeof ACCEPTED_TYPES)[number])
		? null
		: `"${shortName(file.name)}" não serve: envie uma foto (JPG, PNG ou WebP) ou um PDF.`;
}

export function sizeProblem(file: FileLike): string | null {
	return file.size > MAX_FILE_BYTES ? `"${shortName(file.name)}" é grande demais (${formatFileSize(file.size)}). O limite é 4 MB.` : null;
}

/** Mensagem se, somando este arquivo aos já escolhidos, passa de 4 MB no total; null se cabe. */
export function totalProblem(currentBytes: number, file: FileLike, max: number = MAX_TOTAL_BYTES): string | null {
	if (currentBytes + file.size <= max) return null;
	return `"${shortName(file.name)}" não cabe: os anexos podem ter no máximo 4 MB no total (já escolhidos: ${formatFileSize(currentBytes)}). Remova algum ou escolha um arquivo menor.`;
}

/** Mensagem se já não cabe mais um anexo; null se cabe. */
export function countProblem(currentCount: number, max: number = MAX_FILES): string | null {
	if (currentCount < max) return null;
	return max === 1 ? "Só dá para enviar 1 arquivo. Remova o atual para escolher outro." : `Você pode anexar até ${max} arquivos. Remova um para adicionar outro.`;
}

export type DownscalePlan = { action: "keep" } | { action: "resize"; width: number; height: number };

/**
 * Decide se uma imagem deve ser reduzida: só fotos (nunca PDF); já pequena (lado <= 1600 e <= 1,5 MB) fica como está.
 * Ao reduzir, o lado maior vai a 1600 mantendo a proporção; se o lado já é pequeno mas o arquivo é pesado,
 * mantém as dimensões e apenas recomprime em JPEG.
 */
export function planDownscale(img: { type: string; size: number; width: number; height: number }): DownscalePlan {
	if (!isImageType(img.type)) return { action: "keep" };
	const { width, height } = img;
	if (!(width > 0) || !(height > 0)) return { action: "keep" };
	const longest = Math.max(width, height);
	if (longest <= MAX_SIDE && img.size <= SMALL_ENOUGH_BYTES) return { action: "keep" };
	const scale = Math.min(1, MAX_SIDE / longest);
	return { action: "resize", width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Usa o resultado convertido só se ajudou: ficou menor, ou o original não cabia no limite. */
export function shouldUseConverted(originalBytes: number, convertedBytes: number): boolean {
	if (convertedBytes <= 0) return false;
	return convertedBytes < originalBytes || originalBytes > MAX_FILE_BYTES;
}

/** Troca a extensão por .jpg depois de converter. */
export function jpegName(name: string): string {
	const base = name.replace(/\.[a-z0-9]+$/i, "").trim() || "foto";
	return `${base}.jpg`;
}
