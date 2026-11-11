import { describe, expect, it, vi } from "vitest";
import { attachmentKey, deleteAttachments, putAttachment, randomId, type AttachmentStore } from "./attachments";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));

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
	it("deleteAttachments nunca lança", async () => {
		const store = fake();
		store.delete.mockRejectedValue(new Error("boom"));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(deleteAttachments(store, ["k"])).resolves.toBeUndefined();
		await deleteAttachments(store, []);
		expect(store.delete).toHaveBeenCalledTimes(1);
	});
});
