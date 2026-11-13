import { randomId } from "@/lib/random-id";
import { createFsStore } from "./fs-store";
import { createR2Store } from "./r2-s3-store";

/** Anexo já gravado: o que fica no documento da despesa. `key` nunca sai da API. */
export type AttachmentMeta = { id: string; key: string; name: string; contentType: string; size: number };

/** Interface mínima do armazenamento; os testes usam uma implementação em memória. */
export interface AttachmentStore {
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number; contentType?: string } | null>;
	/** Idempotente: apagar uma chave que não existe não é erro. */
	delete(keys: string[]): Promise<void>;
}

type StoreEnv = Record<string, string | undefined>;

/**
 * Escolhe o armazenamento: R2 (API S3) quando as quatro variáveis R2_* existem; senão, disco local
 * (`.data/attachments/`), mas só fora de produção. Em produção sem R2 falha fechado, sem cair para o disco.
 */
export function resolveAttachmentStore(env: StoreEnv = process.env): AttachmentStore {
	const { R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket } = env;
	if (accountId && accessKeyId && secretAccessKey && bucket) {
		return createR2Store({ accountId, accessKeyId, secretAccessKey, bucket });
	}
	if (env.NODE_ENV === "production") {
		throw new Error("Armazenamento de anexos (R2) não está configurado.");
	}
	return createFsStore();
}

export function getAttachmentStore(): AttachmentStore {
	return resolveAttachmentStore();
}

export { randomId };

/** A chave nunca contém o nome do arquivo enviado pelo usuário. */
export function attachmentKey(groupId: string, expenseId: string, attachmentId: string): string {
	return `groups/${groupId}/${expenseId}/${attachmentId}`;
}

/** Foto de um plano: prefixo próprio (o plano ainda não tem grupo). */
export function planAttachmentKey(planId: string, attachmentId: string): string {
	return `plans/${planId}/${attachmentId}`;
}

/** Comprovante de pagamento de uma cota: prefixo próprio, separado dos anexos da despesa. */
export function receiptKey(groupId: string, expenseId: string, receiptId: string): string {
	return `receipts/${groupId}/${expenseId}/${receiptId}`;
}

/** Comprovante de um lote ("pagar tudo de uma vez"): um só objeto referenciado por várias cotas. */
export function batchReceiptKey(batchId: string, receiptId: string): string {
	return `receipts/batch/${batchId}/${receiptId}`;
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

export async function putPlanAttachment(
	store: AttachmentStore,
	args: { planId: string; bytes: Uint8Array; name: string; contentType: string },
): Promise<AttachmentMeta> {
	const id = randomId();
	const key = planAttachmentKey(args.planId, id);
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

export async function putBatchReceipt(
	store: AttachmentStore,
	args: { batchId: string; bytes: Uint8Array; name: string; contentType: string },
): Promise<AttachmentMeta> {
	const id = randomId();
	const key = batchReceiptKey(args.batchId, id);
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
