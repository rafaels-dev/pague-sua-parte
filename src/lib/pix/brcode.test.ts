import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16ccitt } from "./brcode";

/** Implementação independente (tabela de 256 entradas) para cruzar com a bit a bit. */
function crcTable(s: string): string {
	const table: number[] = [];
	for (let n = 0; n < 256; n++) {
		let c = n << 8;
		for (let k = 0; k < 8; k++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1;
		table.push(c & 0xffff);
	}
	let crc = 0xffff;
	for (const byte of new TextEncoder().encode(s)) crc = ((crc << 8) & 0xffff) ^ table[((crc >> 8) ^ byte) & 0xff];
	return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parseTlv(s: string): Record<string, string> {
	const out: Record<string, string> = {};
	let i = 0;
	while (i < s.length) {
		const id = s.slice(i, i + 2);
		const len = Number(s.slice(i + 2, i + 4));
		expect(Number.isInteger(len)).toBe(true);
		const value = s.slice(i + 4, i + 4 + len);
		expect(value).toHaveLength(len);
		out[id] = value;
		i += 4 + len;
	}
	expect(i).toBe(s.length);
	return out;
}

const base = { key: "52998224725", payeeName: "Maria Silva", amountCents: 12345 };

describe("crc16ccitt", () => {
	it("vetor padrão CRC-16/CCITT-FALSE: '123456789' -> 29B1", () => {
		expect(crc16ccitt("123456789")).toBe("29B1");
	});
	it("exemplo publicado no manual do BCB (Fulano de Tal) -> 1D3D", () => {
		const head =
			"00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
		expect(crc16ccitt(head)).toBe("1D3D");
		expect(crcTable(head)).toBe("1D3D");
	});
	it("concorda com a implementação por tabela e tem 4 hex maiúsculos", () => {
		for (const s of ["", "a", "Racha Pix", "00020126", "ÿ"]) {
			expect(crc16ccitt(s)).toBe(crcTable(s));
			expect(crc16ccitt(s)).toMatch(/^[0-9A-F]{4}$/);
		}
	});
});

describe("buildPixPayload", () => {
	it("prefixo idêntico ao do exemplo do manual (mesma chave, nome e valor presente)", () => {
		const p = buildPixPayload({
			key: "123e4567-e12b-12d1-a456-426655440000",
			payeeName: "Fulano de Tal",
			city: "Brasilia",
			amountCents: 100,
		});
		expect(p.startsWith("00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865404")).toBe(true);
	});

	it("campos, um a um", () => {
		const p = buildPixPayload({ ...base, txid: "ABC123", city: "São Paulo" });
		const f = parseTlv(p);
		expect(f["00"]).toBe("01");
		expect(parseTlv(f["26"])).toEqual({ "00": "br.gov.bcb.pix", "01": "52998224725" });
		expect(f["52"]).toBe("0000");
		expect(f["53"]).toBe("986");
		expect(f["54"]).toBe("123.45");
		expect(f["58"]).toBe("BR");
		expect(f["59"]).toBe("MARIA SILVA");
		expect(f["60"]).toBe("SAO PAULO");
		expect(parseTlv(f["62"])).toEqual({ "05": "ABC123" });
		expect(Object.keys(f).sort()).toEqual(["00", "26", "52", "53", "54", "58", "59", "60", "62", "63"]);
	});

	it("CRC cobre tudo até '6304' e fecha o payload", () => {
		const p = buildPixPayload(base);
		expect(p.slice(-8, -4)).toBe("6304");
		expect(p.slice(-4)).toBe(crcTable(p.slice(0, -4)));
		expect(parseTlv(p)["63"]).toBe(p.slice(-4));
	});

	it.each([
		["cpf", "52998224725"],
		["cnpj", "11222333000181"],
		["email", "maria.silva@exemplo.com.br"],
		["phone", "+5511987654321"],
		["random", "123e4567-e12b-42d1-a456-426655440000"],
	])("chave %s vai intacta no campo 26/01", (_t, key) => {
		const f = parseTlv(buildPixPayload({ ...base, key }));
		expect(parseTlv(f["26"])["01"]).toBe(key);
	});

	it("nome: acentos, caixa, pontuação, espaços e truncamento em 25", () => {
		expect(parseTlv(buildPixPayload({ ...base, payeeName: "  José   da Conceição-Ávila!  " }))["59"]).toBe("JOSE DA CONCEICAOAVILA");
		const long = parseTlv(buildPixPayload({ ...base, payeeName: "Maria Aparecida dos Santos Oliveira" }))["59"];
		expect(long).toBe("MARIA APARECIDA DOS SANTO");
		expect(long).toHaveLength(25);
	});

	it("nome que fica vazio após sanitizar usa valor padrão; truncar não deixa espaço no fim", () => {
		expect(parseTlv(buildPixPayload({ ...base, payeeName: "😀 !!!" }))["59"]).toBe("RECEBEDOR");
		expect(parseTlv(buildPixPayload({ ...base, payeeName: "" }))["59"]).toBe("RECEBEDOR");
		expect(parseTlv(buildPixPayload({ ...base, payeeName: "A".repeat(24) + " B" }))["59"]).toBe("A".repeat(24));
	});

	it("cidade: padrão BRASIL, vazia vira BRASIL, máx 15", () => {
		expect(parseTlv(buildPixPayload(base))["60"]).toBe("BRASIL");
		expect(parseTlv(buildPixPayload({ ...base, city: "???" }))["60"]).toBe("BRASIL");
		expect(parseTlv(buildPixPayload({ ...base, city: "Pindamonhangaba do Sul" }))["60"]).toBe("PINDAMONHANGABA");
	});

	it("txid: padrão ***, sanitiza e limita a 25", () => {
		const t = (txid?: string) => parseTlv(parseTlv(buildPixPayload({ ...base, txid }))["62"])["05"];
		expect(t()).toBe("***");
		expect(t("")).toBe("***");
		expect(t("--__")).toBe("***");
		expect(t("racha-pix_2024/01")).toBe("rachapix202401");
		expect(t("x".repeat(40))).toBe("x".repeat(25));
	});

	it("formata o valor", () => {
		const a = (c: number) => parseTlv(buildPixPayload({ ...base, amountCents: c }))["54"];
		expect(a(1)).toBe("0.01");
		expect(a(10)).toBe("0.10");
		expect(a(100)).toBe("1.00");
		expect(a(123456)).toBe("1234.56");
		expect(a(999_999_999_999)).toBe("9999999999.99");
	});

	it("rejeita entradas inválidas", () => {
		for (const amountCents of [0, -1, 1.5, Number.NaN, Infinity, 1_000_000_000_000]) {
			expect(() => buildPixPayload({ ...base, amountCents })).toThrow();
		}
		expect(() => buildPixPayload({ ...base, key: "" })).toThrow();
		expect(() => buildPixPayload({ ...base, key: "   " })).toThrow();
		expect(() => buildPixPayload({ ...base, key: "a".repeat(78) })).toThrow();
	});
});
