import { describe, expect, it } from "vitest";
import {
	countProblem,
	effectiveType,
	formatFileSize,
	jpegName,
	planDownscale,
	shouldUseConverted,
	sizeProblem,
	typeProblem,
} from "./attachments";

const MB = 1024 * 1024;

describe("effectiveType", () => {
	it("usa o tipo declarado", () => expect(effectiveType({ name: "a.png", type: "image/png", size: 1 })).toBe("image/png"));
	it("deduz pela extensão quando vazio", () => {
		expect(effectiveType({ name: "FOTO.JPG", type: "", size: 1 })).toBe("image/jpeg");
		expect(effectiveType({ name: "nota.pdf", type: "", size: 1 })).toBe("application/pdf");
		expect(effectiveType({ name: "x.heic", type: "", size: 1 })).toBe("");
	});
});

describe("validação", () => {
	it("tipo", () => {
		expect(typeProblem({ name: "a.webp", type: "image/webp", size: 1 })).toBeNull();
		expect(typeProblem({ name: "a.pdf", type: "application/pdf", size: 1 })).toBeNull();
		expect(typeProblem({ name: "foto.heic", type: "image/heic", size: 1 })).toMatch(/JPG, PNG ou WebP/);
		expect(typeProblem({ name: "a.gif", type: "image/gif", size: 1 })).not.toBeNull();
	});
	it("tamanho", () => {
		expect(sizeProblem({ name: "a.pdf", type: "application/pdf", size: 5 * MB })).toBeNull();
		expect(sizeProblem({ name: "a.pdf", type: "application/pdf", size: 5 * MB + 1 })).toMatch(/5 MB/);
	});
	it("quantidade", () => {
		expect(countProblem(2)).toBeNull();
		expect(countProblem(3)).toMatch(/até 3/);
	});
	it("nome longo é encurtado na mensagem", () => {
		const msg = typeProblem({ name: `${"a".repeat(60)}.gif`, type: "image/gif", size: 1 });
		expect(msg).toContain("...");
		expect(msg!.length).toBeLessThan(120);
	});
});

describe("planDownscale", () => {
	it("PDF nunca é tocado", () => {
		expect(planDownscale({ type: "application/pdf", size: 9 * MB, width: 5000, height: 5000 })).toEqual({ action: "keep" });
	});
	it("imagem pequena e leve fica como está", () => {
		expect(planDownscale({ type: "image/png", size: 200_000, width: 1200, height: 800 })).toEqual({ action: "keep" });
		expect(planDownscale({ type: "image/jpeg", size: 1.5 * MB, width: 1600, height: 1000 })).toEqual({ action: "keep" });
	});
	it("foto grande de celular é reduzida mantendo a proporção", () => {
		expect(planDownscale({ type: "image/jpeg", size: 4 * MB, width: 4000, height: 3000 })).toEqual({
			action: "resize",
			width: 1600,
			height: 1200,
		});
		expect(planDownscale({ type: "image/jpeg", size: 4 * MB, width: 3000, height: 4000 })).toEqual({
			action: "resize",
			width: 1200,
			height: 1600,
		});
	});
	it("pequena em pixels mas pesada: recomprime sem mudar as dimensões", () => {
		expect(planDownscale({ type: "image/png", size: 3 * MB, width: 1400, height: 900 })).toEqual({
			action: "resize",
			width: 1400,
			height: 900,
		});
	});
	it("dimensões desconhecidas: mantém", () => {
		expect(planDownscale({ type: "image/png", size: 9 * MB, width: 0, height: 0 })).toEqual({ action: "keep" });
	});
});

describe("shouldUseConverted", () => {
	it("usa se ficou menor", () => expect(shouldUseConverted(2 * MB, 500_000)).toBe(true));
	it("mantém o original se o convertido não ajudou", () => expect(shouldUseConverted(500_000, 800_000)).toBe(false));
	it("usa mesmo maior quando o original estoura o limite", () => expect(shouldUseConverted(6 * MB, 6 * MB + 10)).toBe(true));
	it("resultado vazio nunca", () => expect(shouldUseConverted(10, 0)).toBe(false));
});

describe("formatFileSize e jpegName", () => {
	it("tamanhos", () => {
		expect(formatFileSize(512)).toBe("512 B");
		expect(formatFileSize(2048)).toBe("2 KB");
		expect(formatFileSize(1.5 * MB)).toBe("1,5 MB");
	});
	it("nome", () => {
		expect(jpegName("print.png")).toBe("print.jpg");
		expect(jpegName("")).toBe("foto.jpg");
	});
});
