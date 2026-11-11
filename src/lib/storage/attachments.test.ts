import { describe, expect, it, vi } from "vitest";
import { attachmentKey, deleteAttachments, getAttachmentStore, putAttachment, putReceipt, randomId, receiptKey, resolveAttachmentStore, type AttachmentStore } from "./attachments";


const fake = (): AttachmentStore & { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } => ({
	put: vi.fn().mockResolvedValue(undefined),
	get: vi.fn(),
	delete: vi.fn().mockResolvedValue(undefined),
});

describe("attachments", () => {
	it("chave não contém o nome do usuário e usa ids aleatórios", async () => {
		const store = fake();
		const m = await putAttachment(store, { groupId: "g", expenseId: "e", bytes: new Uint8Array(3), name: "../segredo.pdf", contentType: "application/pdf" });
		expect(m.key).toBe(attachmentKey("g", "e", m.id));
		expect(m.key).not.toContain("segredo");
		expect(m.id).toMatch(/^[0-9a-f]{32}$/);
		expect(m.size).toBe(3);
		expect(store.put).toHaveBeenCalledWith(m.key, expect.any(Uint8Array), "application/pdf");
		expect(randomId()).not.toBe(randomId());
	});
	it("comprovante usa prefixo próprio e não leva o nome do arquivo", async () => {
		const store = fake();
		const m = await putReceipt(store, { groupId: "g", expenseId: "e", bytes: new Uint8Array(2), name: "../pix.png", contentType: "image/png" });
		expect(m.key).toBe(receiptKey("g", "e", m.id));
		expect(m.key.startsWith("receipts/g/e/")).toBe(true);
		expect(m.key).not.toContain("pix");
		expect(m.key).not.toBe(attachmentKey("g", "e", m.id));
		expect(store.put).toHaveBeenCalledWith(m.key, expect.any(Uint8Array), "image/png");
	});
	it("deleteAttachments nunca lança", async () => {
		const store = fake();
		store.delete.mockRejectedValue(new Error("boom"));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(deleteAttachments(store, ["k"])).resolves.toBeUndefined();
		await deleteAttachments(store, []);
		expect(store.delete).toHaveBeenCalledTimes(1);
	});
});

describe("resolveAttachmentStore", () => {
	const R2 = { R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "b" };

	it("com as quatro variáveis R2 usa o R2 (também em produção)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			for (const NODE_ENV of ["production", "development"]) {
				await resolveAttachmentStore({ ...R2, NODE_ENV }).get("k");
			}
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(String(fetchMock.mock.calls[0][0].url ?? fetchMock.mock.calls[0][0])).toContain("acct.r2.cloudflarestorage.com");
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it("sem variáveis R2 e fora de produção usa o disco local", async () => {
		for (const NODE_ENV of ["development", "test", undefined]) {
			const store = resolveAttachmentStore({ NODE_ENV });
			expect(await store.get("__nao_existe__/x")).toBeNull();
		}
	});
	it("variável R2 faltando também cai no disco fora de produção", () => {
		const { R2_BUCKET: _omit, ...partial } = R2;
		void _omit;
		expect(() => resolveAttachmentStore({ ...partial, NODE_ENV: "development" })).not.toThrow();
	});
	it("em produção sem R2 falha fechado, sem cair no disco e sem vazar detalhes", () => {
		expect(() => resolveAttachmentStore({ NODE_ENV: "production" })).toThrow("Armazenamento de anexos (R2) não está configurado.");
		const { R2_SECRET_ACCESS_KEY: _omit, ...partial } = R2;
		void _omit;
		expect(() => resolveAttachmentStore({ ...partial, NODE_ENV: "production" })).toThrow();
		expect(() => resolveAttachmentStore({ ...R2, R2_BUCKET: "", NODE_ENV: "production" })).toThrow();
	});
	it("getAttachmentStore lê process.env", () => {
		vi.stubEnv("NODE_ENV", "production");
		for (const k of Object.keys(R2)) vi.stubEnv(k, "");
		try {
			expect(() => getAttachmentStore()).toThrow();
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
