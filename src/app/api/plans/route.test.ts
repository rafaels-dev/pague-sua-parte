import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}
const requireUser = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireUser, UnauthorizedError }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn().mockResolvedValue({ fake: true }) }));
const store = { fakeStore: true };
vi.mock("@/lib/storage/attachments", () => ({ getAttachmentStore: () => store }));
vi.mock("@/lib/notifications/welcome", () => ({ upsertAndWelcome: vi.fn() }));
const createPlan = vi.fn();
const listPlans = vi.fn();
vi.mock("@/lib/plans/repo", () => ({ createPlan, listPlans }));

const { GET, POST } = await import("./route");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.7 hello");

function post(data: unknown, files: { name: string; bytes: Uint8Array }[] = [], headers: Record<string, string> = {}) {
	const form = new FormData();
	form.set("data", JSON.stringify(data));
	for (const f of files) form.append("files", new File([f.bytes as BlobPart], f.name));
	return POST(new Request("http://x/api/plans", { method: "POST", body: form, headers: { "content-length": "1000", ...headers } }));
}

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ uid: "u1", email: "a@b.com", name: "Ana" });
	createPlan.mockResolvedValue({ id: "p1" });
});

describe("POST /api/plans", () => {
	it("201 com a visão do plano; o criador é quem está logado", async () => {
		const res = await post({ name: "Hotel", totalCents: 250000, expectedPeople: 10 }, [{ name: "quarto.png", bytes: PNG }]);
		expect(res.status).toBe(201);
		expect(createPlan.mock.calls[0].slice(2, 4)).toEqual(["u1", { name: "Hotel", totalCents: 250000, expectedPeople: 10 }]);
		expect(createPlan.mock.calls[0][4]).toMatchObject([{ name: "quarto.png", contentType: "image/png" }]);
	});
	it("PDF não vale como foto (415); o tipo vem do conteúdo", async () => {
		const res = await post({ name: "Hotel", totalCents: 100 }, [{ name: "a.png", bytes: PDF }]);
		expect(res.status).toBe(415);
		expect(createPlan).not.toHaveBeenCalled();
	});
	it("mais de 3 fotos: 422; corpo grande demais ou sem tamanho: 413", async () => {
		const four = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.png`, bytes: PNG }));
		expect((await post({ name: "H", totalCents: 100 }, four)).status).toBe(422);
		expect((await post({ name: "H", totalCents: 100 }, [], { "content-length": "9000000" })).status).toBe(413);
	});
	it("dados inválidos: 422 com o campo", async () => {
		const res = await post({ name: "", totalCents: 100 });
		expect(res.status).toBe(422);
		expect((await res.json()).field).toBe("name");
		expect((await post({ name: "H", totalCents: 100, expectedPeople: 1 })).status).toBe(422);
	});
	it("sem login: 401", async () => {
		requireUser.mockRejectedValue(new UnauthorizedError());
		expect((await post({ name: "H", totalCents: 100 })).status).toBe(401);
	});
});

describe("GET /api/plans", () => {
	it("lista os abertos por padrão e os antigos com ?escopo=antigos", async () => {
		listPlans.mockResolvedValue([]);
		await GET(new Request("http://x/api/plans"));
		await GET(new Request("http://x/api/plans?escopo=antigos"));
		expect(listPlans.mock.calls.map((c) => c[2])).toEqual(["open", "old"]);
	});
});
