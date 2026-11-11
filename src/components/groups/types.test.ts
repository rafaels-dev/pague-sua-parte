import { describe, expect, it } from "vitest";
import { normalizeGroupDetail, normalizeMember } from "./types";

describe("normalizeMember", () => {
	it("formato antigo vira pessoa com celular", () => {
		const m = normalizeMember({ uid: "a", name: "Ana", picture: null, role: "member", hasPixKey: true, isYou: true });
		expect(m).toMatchObject({ kind: "user", managedBy: null, youManage: false, canEdit: false, pixKey: null, hasPixKey: true });
	});
	it("pessoa sem celular guarda o responsável", () => {
		const m = normalizeMember({
			uid: "b",
			name: "Benjamim",
			kind: "managed",
			managedBy: { uid: "a", name: "Renata", isYou: true },
			canEdit: true,
		});
		expect(m.kind).toBe("managed");
		expect(m.youManage).toBe(true);
		expect(m.managedBy?.name).toBe("Renata");
		expect(m.hasPixKey).toBe(false);
	});
	it("pessoa com celular nunca é cuidada", () => {
		expect(normalizeMember({ uid: "a", name: "Ana", managedBy: { uid: "x", name: "X", isYou: true }, youManage: true }).youManage).toBe(false);
	});
});

describe("normalizeGroupDetail", () => {
	it("sem membros vira lista vazia", () => {
		expect(normalizeGroupDetail({ id: "1", name: "G", role: "admin" }).members).toEqual([]);
	});
});
