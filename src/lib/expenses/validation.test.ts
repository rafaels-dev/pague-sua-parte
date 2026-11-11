import { describe, expect, it } from "vitest";
import { checkFileLimits, parseExpenseInput, parseParticipantsInput, sanitizeFileName, sniffContentType, sniffFiles, todayInSaoPaulo } from "./validation";

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

describe("parseParticipantsInput", () => {
	it("aceita lista válida, inclusive só um participante", () => {
		expect(parseParticipantsInput({ participantUids: ["a"] })).toEqual({ ok: true, value: ["a"], scope: "this" });
		expect(parseParticipantsInput({ participantUids: ["a", "b"] })).toEqual({ ok: true, value: ["a", "b"], scope: "this" });
	});
	it.each([[null], [[]], ["x"], [{}], [{ participantUids: [] }], [{ participantUids: ["a", "a"] }], [{ participantUids: [1] }], [{ participantUids: "a" }]])(
		"422 em participantUids para %j",
		(raw) => {
			expect(parseParticipantsInput(raw)).toMatchObject({ ok: false, status: 422, field: "participantUids" });
		},
	);
});

describe("parseParticipantsInput: scope", () => {
	it("this (padrão) e following", () => {
		expect(parseParticipantsInput({ participantUids: ["a"], scope: "following" })).toEqual({ ok: true, value: ["a"], scope: "following" });
		expect(parseParticipantsInput({ participantUids: ["a"], scope: "this" })).toMatchObject({ scope: "this" });
	});
	it.each([["all"], [1], [""]])("422 em scope para %j", (scope) => {
		expect(parseParticipantsInput({ participantUids: ["a"], scope })).toMatchObject({ ok: false, status: 422, field: "scope" });
	});
});

describe("parseExpenseInput: vencimento e parcelas", () => {
	// hoje em São Paulo: 2026-11-11
	const p = (extra: Record<string, unknown>) => parseExpenseInput({ ...ok, ...extra }, now);
	const field = (extra: Record<string, unknown>) => {
		const r = p(extra);
		return r.ok ? null : { status: r.status, field: r.field, error: r.error };
	};
	it("dueDate válida passa; ausente/nula não aparece no valor", () => {
		expect(p({ dueDate: "2026-12-10" })).toMatchObject({ ok: true, value: { dueDate: "2026-12-10" } });
		expect(p({ dueDate: "2026-10-01" })).toMatchObject({ ok: true, value: { dueDate: "2026-10-01" } }); // no passado também vale
		const none = p({ dueDate: null });
		expect(none.ok && "dueDate" in none.value).toBe(false);
		const absent = p({});
		expect(absent.ok && "dueDate" in absent.value).toBe(false);
	});
	it("dueDate inválida: 422 em dueDate", () => {
		for (const dueDate of ["2026-02-30", "10/12/2026", "2026-13-01", "abc", 123, "1999-12-31"]) {
			expect(field({ dueDate })).toMatchObject({ status: 422, field: "dueDate" });
		}
	});
	it("no máximo 5 anos à frente", () => {
		expect(p({ dueDate: "2031-11-11" }).ok).toBe(true);
		expect(field({ dueDate: "2031-11-12" })).toMatchObject({ status: 422, field: "dueDate" });
	});
	it("parcelas: count inteiro de 2 a 48 e dueDate obrigatória", () => {
		expect(p({ installments: { count: 2 }, dueDate: "2026-12-10" })).toMatchObject({ ok: true, value: { installments: { count: 2 }, dueDate: "2026-12-10", amountCents: 1000 } });
		expect(p({ installments: { count: 48 }, dueDate: "2026-12-10" }).ok).toBe(true);
		for (const installments of [{ count: 1 }, { count: 49 }, { count: 2.5 }, { count: "3" }, {}, 3, [], "x"]) {
			expect(field({ installments, dueDate: "2026-12-10" })).toMatchObject({ status: 422, field: "installments" });
		}
	});
	it("parcelas sem dueDate: 422 em dueDate pedindo a primeira data", () => {
		const r = field({ installments: { count: 3 } });
		expect(r).toMatchObject({ status: 422, field: "dueDate" });
		expect(r?.error).toMatch(/primeira parcela/);
		expect(field({ installments: { count: 3 }, dueDate: null })).toMatchObject({ field: "dueDate" });
	});
	it("installments nulo é como ausente", () => {
		const r = p({ installments: null });
		expect(r.ok && "installments" in r.value).toBe(false);
	});
});
