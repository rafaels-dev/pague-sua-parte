import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createR2Store, encodeKey } from "./r2-s3-store";

const CONFIG = { accountId: "acct123", accessKeyId: "AKIATEST", secretAccessKey: "secret-test", bucket: "meu-bucket" };
const BASE = "https://acct123.r2.cloudflarestorage.com/meu-bucket";

const fetchMock = vi.fn<(req: Request) => Promise<Response>>();

beforeEach(() => {
	fetchMock.mockReset();
	// aws4fetch assina e envia um Request pelo fetch global.
	vi.stubGlobal("fetch", (input: Request | string, init?: RequestInit) => fetchMock(input instanceof Request ? input : new Request(input, init)));
});
afterEach(() => vi.unstubAllGlobals());

describe("encodeKey", () => {
	it("codifica cada trecho e mantém as barras", () => {
		expect(encodeKey("groups/g1/e1/abc")).toBe("groups/g1/e1/abc");
		expect(encodeKey("a b/c?d/e#f/ç%")).toBe("a%20b/c%3Fd/e%23f/%C3%A7%25");
	});
});

describe("createR2Store", () => {
	it("put: PUT no endereço do bucket, assinado, com tipo e corpo", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
		await createR2Store(CONFIG).put("groups/g/e/a1", new Uint8Array([1, 2, 3]), "image/png");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const req = fetchMock.mock.calls[0][0];
		expect(req.method).toBe("PUT");
		expect(req.url).toBe(`${BASE}/groups/g/e/a1`);
		expect(req.headers.get("content-type")).toBe("image/png");
		const auth = req.headers.get("authorization") ?? "";
		expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request/);
		expect(Array.from(new Uint8Array(await req.arrayBuffer()))).toEqual([1, 2, 3]);
	});
	it("put: erro do R2 vira exceção genérica, sem detalhes", async () => {
		fetchMock.mockResolvedValue(new Response("<Error>detalhe interno</Error>", { status: 403 }));
		await expect(createR2Store(CONFIG).put("k", new Uint8Array(1), "image/png")).rejects.toThrow("R2 put falhou (403)");
	});
	it("get: 200 devolve corpo em stream, tamanho e tipo", async () => {
		fetchMock.mockResolvedValue(new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "content-type": "application/pdf", "content-length": "3" } }));
		const out = await createR2Store(CONFIG).get("receipts/g/e/r1");
		expect(fetchMock.mock.calls[0][0].method).toBe("GET");
		expect(fetchMock.mock.calls[0][0].url).toBe(`${BASE}/receipts/g/e/r1`);
		expect(out?.size).toBe(3);
		expect(out?.contentType).toBe("application/pdf");
		expect(Array.from(new Uint8Array(await new Response(out!.body).arrayBuffer()))).toEqual([9, 8, 7]);
	});
	it("get: 404 vira null e outros erros lançam", async () => {
		fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
		expect(await createR2Store(CONFIG).get("x")).toBeNull();
		fetchMock.mockResolvedValue(new Response("boom", { status: 403 }));
		await expect(createR2Store(CONFIG).get("x")).rejects.toThrow("R2 get falhou (403)");
	});
	it("codifica a chave na URL", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
		await createR2Store(CONFIG).get("a b/ç?x#y");
		expect(fetchMock.mock.calls[0][0].url).toBe(`${BASE}/a%20b/%C3%A7%3Fx%23y`);
	});
	it("delete: um DELETE por chave; 204 e 404 são sucesso (idempotente)", async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 404 }));
		await expect(createR2Store(CONFIG).delete(["k1", "k2"])).resolves.toBeUndefined();
		expect(fetchMock.mock.calls.map(([r]) => [r.method, r.url])).toEqual([
			["DELETE", `${BASE}/k1`],
			["DELETE", `${BASE}/k2`],
		]);
	});
	it("delete: lista vazia não chama a rede e erro de verdade lança", async () => {
		await createR2Store(CONFIG).delete([]);
		expect(fetchMock).not.toHaveBeenCalled();
		fetchMock.mockResolvedValue(new Response("x", { status: 403 }));
		await expect(createR2Store(CONFIG).delete(["k"])).rejects.toThrow("R2 delete falhou (403)");
	});
});
