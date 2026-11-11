import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { AttachmentStore } from "./attachments";

/** Pasta padrão do armazenamento local (ignorada pelo git). Só para desenvolvimento e testes. */
export const DEFAULT_LOCAL_DIR = path.join(".data", "attachments");

/** Armazenamento em disco: um arquivo por chave e um `.meta.json` ao lado com o tipo do conteúdo. */
export function createFsStore(dir: string = DEFAULT_LOCAL_DIR): AttachmentStore {
	const root = path.resolve(dir);
	const fileFor = (key: string) => {
		const target = path.resolve(root, ...key.split("/"));
		// As chaves são geradas pelo servidor; ainda assim nunca saímos da pasta raiz.
		if (!target.startsWith(root + path.sep)) throw new Error("Chave inválida.");
		return target;
	};
	const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT";

	return {
		async put(key, bytes, contentType) {
			const file = fileFor(key);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, bytes);
			await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
		},
		async get(key) {
			const file = fileFor(key);
			try {
				const { size } = await stat(file);
				const meta = await readFile(`${file}.meta.json`, "utf8").then(
					(raw) => JSON.parse(raw) as { contentType?: string },
					() => ({}) as { contentType?: string },
				);
				return { body: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, size, contentType: meta.contentType };
			} catch (err) {
				if (isMissing(err)) return null;
				throw err;
			}
		},
		async delete(keys) {
			for (const key of keys) {
				const file = fileFor(key);
				await rm(file, { force: true });
				await rm(`${file}.meta.json`, { force: true });
			}
		},
	};
}
