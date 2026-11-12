import { describe, expect, it } from "vitest";
import { onInviteFailed, onInviteLoaded } from "./invite-flow";

const G = "65f1a2b3c4d5e6f7a8b9c0d1";
const O = "65f1a2b3c4d5e6f7a8b9c0d9";
const dest = `/app/grupos/${G}/despesas/65f1a2b3c4d5e6f7a8b9c0d2`;

describe("onInviteLoaded", () => {
	it("membro com destino válido vai direto", () => {
		expect(onInviteLoaded({ groupId: G, alreadyMember: true }, dest)).toEqual({ kind: "redirect", to: dest });
	});
	it("membro sem destino vê 'já está no grupo'", () => {
		expect(onInviteLoaded({ groupId: G, alreadyMember: true }, null)).toEqual({ kind: "member" });
	});
	it("membro com destino inválido ou de outro grupo recebe aviso e o grupo", () => {
		for (const bad of ["//evil.com", `/app/grupos/${O}`, "https://evil.com"]) {
			expect(onInviteLoaded({ groupId: G, alreadyMember: true }, bad)).toEqual({ kind: "member-bad-destination", to: `/app/grupos/${G}` });
		}
	});
	it("não membro: aceita e cai no destino válido, ou no grupo", () => {
		expect(onInviteLoaded({ groupId: G, alreadyMember: false }, dest)).toEqual({ kind: "offer", to: dest });
		expect(onInviteLoaded({ groupId: G, alreadyMember: false }, `/app/grupos/${O}`)).toEqual({ kind: "offer", to: `/app/grupos/${G}` });
		expect(onInviteLoaded({ groupId: G, alreadyMember: false }, null)).toEqual({ kind: "offer", to: `/app/grupos/${G}` });
	});
});

describe("onInviteFailed", () => {
	it("destino com forma válida: tenta abrir o grupo (a API protege por membresia)", () => {
		expect(onInviteFailed(dest)).toEqual({ kind: "probe", groupId: G, to: dest });
	});
	it("sem destino ou com destino estranho: só o erro", () => {
		expect(onInviteFailed(null)).toEqual({ kind: "error" });
		expect(onInviteFailed("//evil.com")).toEqual({ kind: "error" });
	});
});
