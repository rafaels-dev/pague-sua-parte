import type { Db } from "mongodb";
import { describeError } from "@/lib/api/http";
import { MAX_FILE_BYTES, sniffContentType, type AllowedContentType } from "@/lib/expenses/validation";
import type { AttachmentStore } from "@/lib/storage/attachments";
import type { ReceiptLine } from "./email-content";
import type { MailAttachment } from "./email";
import { receiptDigest } from "./facts";
import type { Notice, ReceiptTarget } from "./types";

/** Quantas referências de um aviso em lote se conferem; mais que isso, o e-mail manda "veja no app". */
const MAX_REFS = 8;
/** Tempo máximo para ler UM arquivo do armazenamento. */
export const READ_TIMEOUT_MS = 6_000;
/** Folga que sempre sobra para o envio depois da leitura. */
export const SEND_RESERVE_MS = 3_000;
/** Com menos que isto do orçamento do envio, o arquivo nem é lido. */
export const MIN_READ_BUDGET_MS = 5_000;

const EXTENSION: Record<AllowedContentType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export type ReceiptOutcome = { line: "none" } | { line: "app" | "app_many" } | { line: "attached"; attachment: MailAttachment };
export type { ReceiptLine };
/** O que se leu de um arquivo (uma vez por chave, por chamada de `notify`). */
export type FileResult = { ok: true; bytes: Uint8Array; type: AllowedContentType } | { ok: false };
export type FileCache = Map<string, Promise<FileResult>>;

/**
 * Nome do arquivo no e-mail: só ASCII seguro (letras, números, ponto, hífen, sublinhado), sem caminho, sem quebra de linha, até 60
 * caracteres de nome, e a extensão sempre a do tipo REAL detectado (nunca a do nome enviado).
 */
export function safeAttachmentName(raw: string | undefined, type: AllowedContentType): string {
	const ext = EXTENSION[type];
	const base = (raw ?? "")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.split(/[\\/]/)
		.pop()!
		.replace(/\.[A-Za-z0-9]{1,5}$/, "")
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.replace(/_{2,}/g, "_")
		.replace(/^[._-]+|[._-]+$/g, "")
		.slice(0, 60);
	return `${base || "comprovante"}.${ext}`;
}

/**
 * Lê o arquivo (até `MAX_FILE_BYTES`) dentro de `ms`. Estourou o tempo: a leitura é CANCELADA de verdade (o fluxo é abortado e, se o
 * arquivo só chegar depois, também é descartado). Os bytes são montados uma vez.
 */
export async function readStoredFile(store: AttachmentStore, key: string, ms: number): Promise<FileResult> {
	const state: { timedOut: boolean; reader?: ReadableStreamDefaultReader<Uint8Array> } = { timedOut: false };
	const work = (async (): Promise<FileResult> => {
		const file = await store.get(key);
		if (!file) return { ok: false };
		const reader = file.body.getReader();
		state.reader = reader;
		const stop = async (): Promise<FileResult> => {
			await reader.cancel().catch(() => undefined);
			return { ok: false };
		};
		if (state.timedOut || file.size > MAX_FILE_BYTES) return stop();
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;) {
			if (state.timedOut) return stop();
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_FILE_BYTES) return stop();
			chunks.push(value);
		}
		const bytes = new Uint8Array(total);
		let at = 0;
		for (const c of chunks) {
			bytes.set(c, at);
			at += c.byteLength;
		}
		const type = sniffContentType(bytes); // o tipo REAL pelos bytes, não o que foi declarado
		return bytes.byteLength > 0 && type ? { ok: true, bytes, type } : { ok: false };
	})();
	work.catch(() => undefined);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<FileResult>((resolve) => {
		timer = setTimeout(() => {
			state.timedOut = true;
			state.reader?.cancel().catch(() => undefined);
			resolve({ ok: false });
		}, Math.max(1, ms));
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

export type ReceiptDeps = {
	getRef?: (db: Db, t: ReceiptTarget, viewerUid: string) => Promise<{ status: "ok"; key: string; name: string; contentType: string } | { status: "not_found" }>;
	store?: () => AttachmentStore;
	/** Instante limite do envio (tudo do `notify`). Com pouco tempo sobrando, o arquivo nem é lido. */
	deadline?: number;
	now?: () => number;
	/** Arquivos já lidos nesta chamada de `notify`, por chave: cada arquivo distinto é lido UMA vez, para todos os destinatários. A permissão NÃO é guardada aqui. */
	cache?: FileCache;
};

/**
 * Decide o que o e-mail de `notice` diz sobre o comprovante e, se couber, lê o arquivo para anexar.
 * AUTORIZAÇÃO: cada referência passa por `getReceiptRef` (a mesma função das rotas de download, que usa `canViewReceipt`) com o
 * DESTINATÁRIO do aviso como quem pede, SEMPRE antes de qualquer uso do cache. Quem não poderia baixar o comprovante não recebe anexo
 * nem a linha sobre ele ("none"). IDENTIDADE: se o arquivo atual não tem o mesmo resumo (SHA-256 da chave) registrado no pagamento,
 * o comprovante foi trocado e não se anexa nada. Só se anexa quando UM arquivo cobre TODOS os pagamentos do aviso; senão, "veja no app".
 * Qualquer falha ao ler ou anexar vira "app" ou "none"; nunca lança.
 */
export async function resolveReceiptAttachment(db: Db, notice: Pick<Notice, "uid" | "receipts" | "receiptsOf">, deps: ReceiptDeps = {}): Promise<ReceiptOutcome> {
	const targets = notice.receipts ?? [];
	if (targets.length === 0) return { line: "none" };
	try {
		const total = Math.max(notice.receiptsOf ?? targets.length, targets.length);
		const appLine = total > 1 ? "app_many" : "app";
		const getRef =
			deps.getRef ??
			(async (d: Db, t: ReceiptTarget, viewer: string) => {
				// Sob demanda: evita o ciclo de importação (repositório de despesas -> avisos -> este arquivo).
				const { getReceiptRef } = await import("@/lib/expenses/repo");
				return getReceiptRef(d, t.groupId, t.expenseId, t.targetUid, viewer, t.kind, t.partId);
			});
		const keys = new Map<string, string>(); // chave -> nome
		let allowed = 0;
		let changed = false;
		for (const t of targets.slice(0, MAX_REFS)) {
			try {
				const ref = await getRef(db, t, notice.uid);
				if (ref.status !== "ok") continue;
				allowed++;
				if (t.digest && receiptDigest(ref.key) !== t.digest) changed = true;
				else keys.set(ref.key, ref.name);
			} catch (err) {
				// Sem conseguir conferir a permissão, esta referência vale como "não pode".
				console.error("receipt permission error:", describeError(err));
			}
		}
		if (allowed === 0) return { line: "none" }; // quem recebe não poderia baixar: nada sobre o comprovante
		if (changed || targets.length > MAX_REFS || allowed !== total || keys.size !== 1) return { line: appLine };
		const [[key, name]] = [...keys];
		const now = deps.now ?? Date.now;
		const left = deps.deadline === undefined ? Infinity : deps.deadline - now();
		if (left < MIN_READ_BUDGET_MS) return { line: appLine };
		const cache = deps.cache;
		const ms = Math.min(READ_TIMEOUT_MS, left - SEND_RESERVE_MS);
		const getStore = deps.store ?? (await defaultStore());
		// Sem `await` entre ler e gravar no cache: dois e-mails ao mesmo tempo nunca leem o mesmo arquivo duas vezes.
		let reading = cache?.get(key);
		if (!reading) {
			reading = readStoredFile(getStore(), key, ms);
			cache?.set(key, reading);
		}
		// Quem só espera um arquivo que outro e-mail está lendo também respeita o próprio prazo.
		let waitTimer: ReturnType<typeof setTimeout> | undefined;
		const gaveUp = new Promise<FileResult>((r) => {
			waitTimer = setTimeout(() => r({ ok: false }), Math.max(1, ms));
		});
		const file = await Promise.race([reading, gaveUp]).finally(() => clearTimeout(waitTimer));
		if (!file.ok) return { line: appLine };
		return { line: "attached", attachment: { filename: safeAttachmentName(name, file.type), contentType: file.type, bytes: file.bytes } };
	} catch (err) {
		console.error("receipt attachment error:", describeError(err));
		return { line: "app" };
	}
}

async function defaultStore(): Promise<() => AttachmentStore> {
	const { getAttachmentStore } = await import("@/lib/storage/attachments");
	return getAttachmentStore;
}
