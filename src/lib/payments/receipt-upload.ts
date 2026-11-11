import { MAX_FILE_BYTES, sniffFiles, type SniffedFile } from "@/lib/expenses/validation";

export const RECEIPT_TOO_BIG = "O comprovante pode ter no máximo 4 MB.";

/**
 * Lê o campo `file` de um formulário de comprovante (compartilhado pelo "já paguei" de uma cota e pelo pagamento em lote):
 * no máximo um arquivo, JPG/PNG/WebP/PDF farejados pelos bytes, até 4 MB. Sem arquivo: `{ ok: true }`.
 */
export async function readReceiptFile(form: FormData): Promise<{ ok: true; file?: SniffedFile } | { ok: false; error: string }> {
	const picked = form.getAll("file");
	// Campo de arquivo vazio (nenhum arquivo escolhido) chega como File de 0 bytes sem nome: vale como "sem arquivo".
	const files = picked.filter((f): f is File => typeof f !== "string" && !(f.size === 0 && !f.name));
	if (picked.some((f) => typeof f === "string" && f !== "") || files.length > 1) {
		return { ok: false, error: "Envie um único comprovante." };
	}
	if (files.length === 0) return { ok: true };
	if (files[0].size > MAX_FILE_BYTES) return { ok: false, error: RECEIPT_TOO_BIG };
	const bytes = new Uint8Array(await files[0].arrayBuffer());
	const sniffed = sniffFiles([{ name: files[0].name, bytes }]);
	if (!sniffed.ok) {
		return { ok: false, error: sniffed.status === 415 ? "Só aceitamos foto (JPG, PNG, WebP) ou PDF." : RECEIPT_TOO_BIG };
	}
	return { ok: true, file: sniffed.files[0] };
}
