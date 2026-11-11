import { describe, expect, it } from "vitest";
import { checkFileLimits, parseExpenseInput, sanitizeFileName, sniffContentType, sniffFiles, todayInSaoPaulo } from "./validation";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const EXE = new TextEncoder().encode("MZ\x90\0\x03\0\0\0");
const now = new Date("2026-11-11T15:00:00Z");
const ok = { description: "Mercado", amountCents: 1000, participantUids: ["a"] };

describe("sniffContentType", () => {
	it("reconhece pelos magic bytes", () => {
		expect(sniffContentType(JPEG)).toBe("image/jpeg");
		expect(sniffContentType(PNG)).toBe("image/png");
		expect(sniffContentType(WEBP)).toBe("image/webp");
		expect(sniffContentType(PDF)).toBe("application/pdf");
	});
	it("rejeita executável e RIFF que não é WebP", () => {
		expect(sniffContentType(EXE)).toBeNull();
		expect(sniffContentType(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
		expect(sniffContentType(new Uint8Array())).toBeNull();
	});
});

describe("sniffFiles", () => {
	it("usa o conteúdo, não o nome: PDF chamado .jpg vira application/pdf", () => {
		const r = sniffFiles([{ name: "foto.jpg", bytes: PDF }]);
		expect(r.ok && r.files[0].contentType).toBe("application/pdf");
	});
	it("415 para executável (mesmo declarado como imagem)", () => {
		const r = sniffFiles([{ name: "x.png", bytes: EXE }]);
		expect(r).toEqual({ ok: false, status: 415, error: "Só aceitamos foto (JPG, PNG, WebP) ou PDF.", field: "files" });
	});
	it("413 acima de 5 MB e 422 acima de 3 arquivos", () => {
		const big = new Uint8Array(5 * 1024 * 1024 + 1);
		big.set(PDF);
		expect(sniffFiles([{ name: "a.pdf", bytes: big }])).toMatchObject({ ok: false, status: 413, field: "files" });
		const four = Array.from({ length: 4 }, () => ({ name: "a.pdf", bytes: PDF }));
		expect(sniffFiles(four)).toMatchObject({ ok: false, status: 422, field: "files" });
		expect(checkFileLimits([{ size: 5 * 1024 * 1024 }])).toBeNull();
	});
	it("exatamente 5 MB e 3 arquivos passam", () => {
		const edge = new Uint8Array(5 * 1024 * 1024);
		edge.set(PDF);
		expect(sniffFiles([1, 2, 3].map(() => ({ name: "a.pdf", bytes: edge })))).toMatchObject({ ok: true });
	});
});

describe("sanitizeFileName", () => {
	it("remove separadores, controle e aspas; limita a 80", () => {
		expect(sanitizeFileName("../../etc/pa\\ss\"wd\n.pdf", "application/pdf")).toBe("....etcpasswd.pdf".replace(/^\.+/, ""));
		expect(sanitizeFileName("a".repeat(200), "image/png")).toHaveLength(80);
	});
	it("usa nome padrão quando sobra nada", () => {
		expect(sanitizeFileName("///", "application/pdf")).toBe("anexo.pdf");
		expect(sanitizeFileName("", "image/jpeg")).toBe("anexo.jpg");
	});
});

describe("parseExpenseInput", () => {
	const bad = (raw: unknown) => {
		const r = parseExpenseInput(raw, now);
		return r.ok ? null : r;
	};
	it("aceita e usa a data de hoje em São Paulo por padrão", () => {
		const r = parseExpenseInput({ ...ok, description: "  Mercado  " }, now);
		expect(r).toEqual({ ok: true, value: { ...ok, description: "Mercado", date: "2026-11-11" } });
		expect(todayInSaoPaulo(new Date("2026-11-11T02:00:00Z"))).toBe("2026-11-10");
	});
	it("descrição", () => {
		expect(bad({ ...ok, description: "   " })?.field).toBe("description");
		expect(bad({ ...ok, description: "a".repeat(81) })?.field).toBe("description");
		expect(bad({ ...ok, description: undefined })?.field).toBe("description");
	});
	it("valor", () => {
		for (const amountCents of [0, -1, 1.5, "10", 100_000_001, null]) expect(bad({ ...ok, amountCents })?.field).toBe("amountCents");
		expect(parseExpenseInput({ ...ok, amountCents: 100_000_000 }, now).ok).toBe(true);
	});
	it("data", () => {
		expect(bad({ ...ok, date: "2026-02-30" })?.field).toBe("date");
		expect(bad({ ...ok, date: "11/11/2026" })?.field).toBe("date");
		expect(bad({ ...ok, date: "1999-12-31" })?.field).toBe("date");
		expect(bad({ ...ok, date: "2026-11-13" })?.field).toBe("date");
		expect(parseExpenseInput({ ...ok, date: "2026-11-12" }, now).ok).toBe(true);
		expect(parseExpenseInput({ ...ok, date: "2000-01-01" }, now).ok).toBe(true);
	});
	it("participantes", () => {
		expect(bad({ ...ok, participantUids: [] })?.field).toBe("participantUids");
		expect(bad({ ...ok, participantUids: "a" })?.field).toBe("participantUids");
		expect(bad({ ...ok, participantUids: ["a", "a"] })?.field).toBe("participantUids");
	});
	it("corpo que não é objeto", () => {
		expect(bad(null)?.status).toBe(422);
		expect(bad([])?.status).toBe(422);
	});
});
