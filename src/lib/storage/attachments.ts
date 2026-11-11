import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Anexo já gravado: o que fica no documento da despesa. `key` nunca sai da API. */
export type AttachmentMeta = { id: string; key: string; name: string; contentType: string; size: number };

/** Interface mínima do armazenamento; os testes usam uma implementação em memória. */
export interface AttachmentStore {
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
	delete(keys: string[]): Promise<void>;
}

/** Adaptador sobre o binding R2 `ATTACHMENTS` (wrangler.jsonc). */
export function getAttachmentStore(): AttachmentStore {
	const bucket = (getCloudflareContext().env as unknown as { ATTACHMENTS?: R2Bucket }).ATTACHMENTS;
	if (!bucket) throw new Error("Binding ATTACHMENTS (R2) não está configurado.");
	return {
		async put(key, bytes, contentType) {
			await bucket.put(key, bytes, { httpMetadata: { contentType } });
		},
		async get(key) {
			const obj = await bucket.get(key);
			if (!obj) return null;
			return { body: obj.body as ReadableStream<Uint8Array>, size: obj.size };
		},
		async delete(keys) {
			if (keys.length) await bucket.delete(keys);
		},
	};
}

/** 128 bits aleatórios (Web Crypto) em hexadecimal. */
export function randomId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A chave nunca contém o nome do arquivo enviado pelo usuário. */
export function attachmentKey(groupId: string, expenseId: string, attachmentId: string): string {
	return `groups/${groupId}/${expenseId}/${attachmentId}`;
}

/** Comprovante de pagamento de uma cota: prefixo próprio, separado dos anexos da despesa. */
export function receiptKey(groupId: string, expenseId: string, receiptId: string): string {
	return `receipts/${groupId}/${expenseId}/${receiptId}`;
}

export async function putAttachment(
	store: AttachmentStore,
	args: { groupId: string; expenseId: string; bytes: Uint8Array; name: string; contentType: string },
): Promise<AttachmentMeta> {
	const id = randomId();
	const key = attachmentKey(args.groupId, args.expenseId, id);
	await store.put(key, args.bytes, args.contentType);
	return { id, key, name: args.name, contentType: args.contentType, size: args.bytes.byteLength };
}

export async function putReceipt(
	store: AttachmentStore,
	args: { groupId: string; expenseId: string; bytes: Uint8Array; name: string; contentType: string },
): Promise<AttachmentMeta> {
	const id = randomId();
	const key = receiptKey(args.groupId, args.expenseId, id);
	await store.put(key, args.bytes, args.contentType);
	return { id, key, name: args.name, contentType: args.contentType, size: args.bytes.byteLength };
}

export function getAttachment(store: AttachmentStore, key: string) {
	return store.get(key);
}

/** Melhor esforço: nunca lança (usado em limpeza). */
export async function deleteAttachments(store: AttachmentStore, keys: string[]): Promise<void> {
	if (!keys.length) return;
	try {
		await store.delete(keys);
	} catch (err) {
		console.error("deleteAttachments error:", err instanceof Error ? err.name : "unknown");
	}
}
