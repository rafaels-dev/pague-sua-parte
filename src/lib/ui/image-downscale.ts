import { JPEG_QUALITY, effectiveType, jpegName, planDownscale, shouldUseConverted } from "./attachments";

/**
 * Reduz uma foto no navegador (lado maior <= 1600 px, JPEG ~0,8) para o envio ser rápido e caber no limite.
 * PDFs e imagens já pequenas passam direto; qualquer falha devolve o arquivo original.
 */
export async function downscaleImage(file: File): Promise<File> {
	try {
		const type = effectiveType(file);
		if (!type.startsWith("image/")) return file;

		// "from-image" aplica a rotação EXIF: fotos de celular não ficam deitadas.
		const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
		try {
			const plan = planDownscale({ type, size: file.size, width: bitmap.width, height: bitmap.height });
			if (plan.action === "keep") return file;

			const canvas = document.createElement("canvas");
			canvas.width = plan.width;
			canvas.height = plan.height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return file;
			// JPEG não tem transparência: prints com fundo transparente ficariam pretos.
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, plan.width, plan.height);
			ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);

			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
			if (!blob || !shouldUseConverted(file.size, blob.size)) return file;
			return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
		} finally {
			bitmap.close();
		}
	} catch {
		return file;
	}
}
