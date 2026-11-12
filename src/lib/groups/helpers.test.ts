import { describe, expect, it } from "vitest";
import { actsFor, canLaunchPaidBy, expenseRole, generateInviteToken, isGroupAdmin, generateManagedUid, isManagedMember, isManagedUid, isObjectIdHex, isPlausibleToken, newInviteExpiry, sortMembers, type MemberView } from "./helpers";

const m = (name: string, role: "admin" | "member"): MemberView => ({
	uid: name,
	name,
	picture: null,
	role,
	hasPixKey: false,
	isYou: false,
	kind: "user",
	managedBy: null,
	youManage: false,
	canEdit: false,
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

describe("pessoas sem login", () => {
	const members = [
		{ uid: "renata", role: "admin" as const },
		{ uid: "ana", role: "member" as const },
		{ uid: "m_ben", role: "member" as const, kind: "managed" as const, managedBy: "renata" },
	];
	it("actsFor: a si mesmo ou a quem cuida; nunca a outro membro real nem a pessoa de outro responsável", () => {
		expect(actsFor(members, "renata", "renata")).toBe(true);
		expect(actsFor(members, "renata", "m_ben")).toBe(true);
		expect(actsFor(members, "ana", "m_ben")).toBe(false);
		expect(actsFor(members, "renata", "ana")).toBe(false);
		expect(actsFor(members, "renata", "m_outro")).toBe(false);
		expect(actsFor(members, "m_ben", "m_ben")).toBe(true); // identidade; ninguém autentica como m_*
	});
	it("um membro real com uid parecido não é pessoa sem login (vale o cadastro, não o formato)", () => {
		const real = [{ uid: "renata" }, { uid: "m_fake", role: "member" as const }];
		expect(isManagedMember(real, "m_fake")).toBe(false);
		expect(actsFor(real, "renata", "m_fake")).toBe(false);
	});
	it("generateManagedUid: m_ + base64url, único", () => {
		const a = generateManagedUid();
		expect(a).toMatch(/^m_[A-Za-z0-9_-]{22}$/);
		expect(isManagedUid(a)).toBe(true);
		expect(generateManagedUid()).not.toBe(a);
	});
	it("sortMembers: admins, usuários reais por nome, depois pessoas sem login por nome", () => {
		const managed = (name: string): MemberView => ({ ...m(name, "member"), kind: "managed" });
		const out = sortMembers([managed("Ana Avó"), m("Zé", "member"), managed("Benjamim"), m("Wilson", "admin"), m("Bia", "member")]);
		expect(out.map((x) => x.name)).toEqual(["Wilson", "Bia", "Zé", "Ana Avó", "Benjamim"]);
	});
});

describe("isGroupAdmin / expenseRole", () => {
	const members = [
		{ uid: "adm", role: "admin" as const },
		{ uid: "dono", role: "member" as const },
		{ uid: "outro", role: "member" as const },
		{ uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "dono" },
		{ uid: "m_fake", role: "admin" as const, kind: "managed" as const, managedBy: "outro" },
	];
	it("administra quem tem role admin; pessoa sem login nunca administra", () => {
		expect(isGroupAdmin(members, "adm")).toBe(true);
		expect(isGroupAdmin(members, "dono")).toBe(false);
		expect(isGroupAdmin(members, "m_fake")).toBe(false);
		expect(isGroupAdmin(members, "ninguem")).toBe(false);
	});
	it("o dono (ou quem cuida dele) vale como dono; admin como admin; os demais, nada", () => {
		expect(expenseRole(members, "dono", "dono")).toBe("owner");
		expect(expenseRole(members, "dono", "m_vo")).toBe("owner");
		expect(expenseRole(members, "adm", "dono")).toBe("admin");
		expect(expenseRole(members, "adm", "adm")).toBe("owner");
		expect(expenseRole(members, "outro", "dono")).toBeNull();
		expect(expenseRole(members, "ninguem", "dono")).toBeNull();
	});
});

describe("canLaunchPaidBy", () => {
	const members = [
		{ uid: "adm", role: "admin" as const },
		{ uid: "ana", role: "member" as const },
		{ uid: "bia", role: "member" as const },
		{ uid: "m_vo", role: "member" as const, kind: "managed" as const, managedBy: "ana" },
		{ uid: "m_adm", role: "admin" as const, kind: "managed" as const, managedBy: "ana" },
	];
	it("o próprio e quem cuida", () => {
		expect(canLaunchPaidBy(members, "ana", "ana")).toBe(true);
		expect(canLaunchPaidBy(members, "ana", "m_vo")).toBe(true);
	});
	it("administrador: qualquer membro do grupo", () => {
		for (const p of ["ana", "bia", "m_vo", "adm"]) expect(canLaunchPaidBy(members, "adm", p)).toBe(true);
	});
	it("membro comum não lança por outro; pagador fora do grupo nunca; pessoa sem login 'admin' não vale", () => {
		expect(canLaunchPaidBy(members, "ana", "bia")).toBe(false);
		expect(canLaunchPaidBy(members, "bia", "m_vo")).toBe(false);
		expect(canLaunchPaidBy(members, "adm", "fora")).toBe(false);
		expect(canLaunchPaidBy(members, "m_adm", "bia")).toBe(false);
	});
});
