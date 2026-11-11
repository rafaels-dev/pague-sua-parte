import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsStore } from "./fs-store";
import type { AttachmentStore } from "./attachments";

let dir: string;
let store: AttachmentStore;

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), "attachments-test-"));
	store = createFsStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const read = async (body: ReadableStream<Uint8Array>) => Array.from(new Uint8Array(await new Response(body).arrayBuffer()));

describe("createFsStore", () => {
	it("grava e lê de volta com tamanho e tipo", async () => {
		await store.put("groups/g/e/a1", new Uint8Array([1, 2, 3, 4]), "image/png");
		const out = await store.get("groups/g/e/a1");
		expect(out?.size).toBe(4);
		expect(out?.contentType).toBe("image/png");
		expect(await read(out!.body)).toEqual([1, 2, 3, 4]);
	});
	it("chave inexistente devolve null", async () => {
		expect(await store.get("groups/g/e/nada")).toBeNull();
	});
	it("apagar é idempotente e remove também os metadados", async () => {
		await store.put("a/b", new Uint8Array(2), "application/pdf");
		await store.delete(["a/b", "nao/existe"]);
		await store.delete(["a/b"]);
		expect(await store.get("a/b")).toBeNull();
		expect(await readdir(path.join(dir, "a"))).toEqual([]);
	});
	it("nunca sai da pasta raiz", async () => {
		await expect(store.put("../fora", new Uint8Array(1), "image/png")).rejects.toThrow();
		await expect(store.get("a/../../fora")).rejects.toThrow();
	});
});
