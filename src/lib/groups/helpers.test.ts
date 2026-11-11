import { describe, expect, it } from "vitest";
import { generateInviteToken, isObjectIdHex, isPlausibleToken, newInviteExpiry, sortMembers, type MemberView } from "./helpers";

const m = (name: string, role: "admin" | "member"): MemberView => ({
	uid: name,
	name,
	picture: null,
	role,
	hasPixKey: false,
	isYou: false,
});

describe("generateInviteToken", () => {
	it("gera 32 bytes em base64url (43 caracteres) e diferentes a cada chamada", () => {
		const a = generateInviteToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(generateInviteToken()).not.toBe(a);
		expect(isPlausibleToken(a)).toBe(true);
	});
});

describe("validações de formato", () => {
	it("isObjectIdHex", () => {
		expect(isObjectIdHex("507f1f77bcf86cd799439011")).toBe(true);
		expect(isObjectIdHex("abc")).toBe(false);
		expect(isObjectIdHex("zzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
	});
	it("isPlausibleToken rejeita lixo", () => {
		expect(isPlausibleToken("curto")).toBe(false);
		expect(isPlausibleToken("a".repeat(40) + "$")).toBe(false);
	});
});

describe("newInviteExpiry", () => {
	it("vale 7 dias", () => {
		const now = new Date("2026-01-01T00:00:00Z");
		expect(newInviteExpiry(now).toISOString()).toBe("2026-01-08T00:00:00.000Z");
	});
});

describe("sortMembers", () => {
	it("admins primeiro, depois por nome", () => {
		const out = sortMembers([m("Zé", "member"), m("Ana", "member"), m("Wilson", "admin"), m("Bia", "admin")]);
		expect(out.map((x) => x.name)).toEqual(["Bia", "Wilson", "Ana", "Zé"]);
	});
});
