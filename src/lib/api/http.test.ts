import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "@/lib/expenses/validation";
import { MULTIPART_OVERHEAD_BYTES, PLATFORM_MAX_BODY_BYTES, bodyTooLarge } from "./http";

const req = (contentLength?: string) => new Request("http://x", { method: "POST", headers: contentLength === undefined ? {} : { "content-length": contentLength } });

describe("bodyTooLarge", () => {
	it("aceita até o limite e recusa acima", () => {
		expect(bodyTooLarge(req("1000"), 1000)).toBe(false);
		expect(bodyTooLarge(req("1001"), 1000)).toBe(true);
	});
	it("recusa Content-Length ausente, inválido ou negativo", () => {
		expect(bodyTooLarge(req(), 1000)).toBe(true);
		expect(bodyTooLarge(req("abc"), 1000)).toBe(true);
		expect(bodyTooLarge(req("-1"), 1000)).toBe(true);
	});
	it("nunca aceita mais que o limite de 4,5 MB da Vercel, seja qual for o limite pedido", () => {
		expect(bodyTooLarge(req(String(PLATFORM_MAX_BODY_BYTES)), 100 * 1024 * 1024)).toBe(false);
		expect(bodyTooLarge(req(String(PLATFORM_MAX_BODY_BYTES + 1)), 100 * 1024 * 1024)).toBe(true);
	});
	it("os limites de anexo mais a folga do multipart cabem nos 4,5 MB da Vercel", () => {
		expect(MAX_FILE_BYTES).toBe(4 * 1024 * 1024);
		expect(MAX_TOTAL_BYTES).toBe(4 * 1024 * 1024);
		expect(MAX_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES).toBeLessThanOrEqual(PLATFORM_MAX_BODY_BYTES);
	});
});
