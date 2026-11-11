import { AwsClient } from "aws4fetch";
import type { AttachmentStore } from "./attachments";

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

/** Codifica cada trecho da chave separadamente: as barras continuam separando pastas. */
export function encodeKey(key: string): string {
	return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * Armazenamento no Cloudflare R2 pela API compatível com S3 (assinatura v4 via aws4fetch, só `fetch`).
 * Endpoint: https://<conta>.r2.cloudflarestorage.com/<bucket>/<chave>, região "auto".
 */
export function createR2Store(config: R2Config): AttachmentStore {
	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: "auto",
		retries: 2,
	});
	const base = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}`;
	const urlFor = (key: string) => `${base}/${encodeKey(key)}`;

	return {
		async put(key, bytes, contentType) {
			// Assina primeiro e envia os bytes direto: assim o `fetch` manda Content-Length. Passando o corpo por um
			// Request (como o `client.fetch` faz), alguns ambientes enviam em pedaços e o R2 recusa com 411.
			const signed = await client.sign(urlFor(key), { method: "PUT", headers: { "Content-Type": contentType, "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD" } });
			const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes as BodyInit });
			if (!res.ok) throw new Error(`R2 put falhou (${res.status})`);
			await res.body?.cancel();
		},
		async get(key) {
			const res = await client.fetch(urlFor(key), { method: "GET" });
			if (res.status === 404) {
				await res.body?.cancel();
				return null;
			}
			if (!res.ok || !res.body) throw new Error(`R2 get falhou (${res.status})`);
			const size = Number(res.headers.get("content-length"));
			return {
				body: res.body as ReadableStream<Uint8Array>,
				size: Number.isFinite(size) ? size : 0,
				contentType: res.headers.get("content-type") ?? undefined,
			};
		},
		async delete(keys) {
			await Promise.all(
				keys.map(async (key) => {
					const res = await client.fetch(urlFor(key), { method: "DELETE" });
					await res.body?.cancel();
					// Apagar o que já não existe (404) é sucesso: a operação é idempotente.
					if (!res.ok && res.status !== 404) throw new Error(`R2 delete falhou (${res.status})`);
				}),
			);
		},
	};
}
