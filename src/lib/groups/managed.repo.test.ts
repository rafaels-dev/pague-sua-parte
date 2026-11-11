import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { acceptInvite, addManagedMember, getGroupDetail, removeMember, setMemberRole, updateManagedMember } from "./repo";

const GID = "507f1f77bcf86cd799439011";
const TOKEN = "t".repeat(43);
const PIX = { type: "cpf" as const, key: "52998224725" };
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const managed = (uid: string, name: string, managedBy: string, pixKey?: typeof PIX) => ({
	uid,
	role: "member" as const,
	joinedAt: new Date(),
	kind: "managed" as const,
	name,
	managedBy,
	...(pixKey ? { pixKey } : {}),
});
// u1 admin, u2 = Renata (responsável), u3 outro membro, m_ben = Benjamim (cuidado por u2)
const group = (members = [member("u1", "admin"), member("u2"), member("u3"), managed("m_ben", "Benjamim", "u2", PIX)]) => ({
	_id: new ObjectId(GID),
	name: "Família",
	createdBy: "u1",
	members,
	invite: null,
});

function mockDb(o: { group?: unknown; matched?: number; users?: unknown[] } = {}) {
	const groups = {
		findOne: vi.fn().mockResolvedValue("group" in o ? o.group : group()),
		updateOne: vi.fn().mockResolvedValue({ matchedCount: o.matched ?? 1 }),
		findOneAndUpdate: vi.fn().mockResolvedValue(null),
	};
	const users = { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(o.users ?? []) }) };
	const db = { collection: (n: string) => (n === "groups" ? groups : users) } as unknown as Db;
	return { db, groups, users };
}

describe("getGroupDetail com pessoas sem login", () => {
	const users = [
		{ _id: "u1", name: "Admin", pixKey: { type: "cpf", key: "SEGREDO1" } },
		{ _id: "u2", name: "Renata", pixKey: { type: "cpf", key: "SEGREDO2" }, email: "r@x.com" },
		{ _id: "u3", name: "Caio" },
	];
	it("responsável vê a chave e canEdit; managedBy com nome; ordem admins, reais, sem login", async () => {
		const { db, users: u } = mockDb({ users });
		const d = (await getGroupDetail(db, GID, "u2"))!;
		expect(d.members.map((m) => m.uid)).toEqual(["u1", "u3", "u2", "m_ben"]);
		expect(d.members.find((m) => m.uid === "m_ben")).toEqual({
			uid: "m_ben", name: "Benjamim", picture: null, role: "member", hasPixKey: true, isYou: false,
			kind: "managed", managedBy: { uid: "u2", name: "Renata", isYou: true }, youManage: true, canEdit: true, pixKey: PIX,
		});
		// o documento de users só é consultado para membros reais
		expect(u.find.mock.calls[0][0]._id.$in).toEqual(["u1", "u2", "u3"]);
		const json = JSON.stringify(d);
		expect(json).not.toContain("SEGREDO");
		expect(json).not.toContain("r@x.com");
	});
	it("admin edita; outro membro vê hasPixKey mas nunca a chave", async () => {
		const asAdmin = (await getGroupDetail(mockDb({ users }).db, GID, "u1"))!.members.find((m) => m.uid === "m_ben")!;
		expect(asAdmin).toMatchObject({ canEdit: true, youManage: false, pixKey: PIX, managedBy: { isYou: false } });
		const other = (await getGroupDetail(mockDb({ users }).db, GID, "u3"))!;
		const ben = other.members.find((m) => m.uid === "m_ben")!;
		expect(ben).toMatchObject({ canEdit: false, youManage: false, hasPixKey: true });
		expect(ben).not.toHaveProperty("pixKey");
		expect(JSON.stringify(other)).not.toContain(PIX.key);
	});
	it("sem chave: pixKey null para quem edita", async () => {
		const g = group([member("u1", "admin"), managed("m_x", "Vó", "u1")]);
		const ben = (await getGroupDetail(mockDb({ group: g, users }).db, GID, "u1"))!.members.find((m) => m.uid === "m_x")!;
		expect(ben).toMatchObject({ hasPixKey: false, pixKey: null });
	});
});

describe("addManagedMember", () => {
	it("um update atômico: admin agora, responsável real agora, vaga; uid gerado m_*; sempre member", async () => {
		const { db, groups } = mockDb();
		const r = await addManagedMember(db, GID, "u1", { name: "Benjamim", managedBy: "u2", pixKey: PIX });
		expect(r.status === "ok" && r.uid).toMatch(/^m_/);
		const [filter, update] = groups.updateOne.mock.calls[0];
		expect(filter.$and).toEqual([
			{ members: { $elemMatch: { uid: "u1", role: "admin" } } },
			{ members: { $elemMatch: { uid: "u2", kind: { $ne: "managed" } } } },
		]);
		expect(filter["members.49"]).toEqual({ $exists: false });
		expect(update.$push.members).toMatchObject({ role: "member", kind: "managed", name: "Benjamim", managedBy: "u2", pixKey: PIX });
	});
	it("explica a falha: não membro 404, não admin 403, responsável inválido, cheio", async () => {
		const call = (g: unknown, by = "u2") => addManagedMember(mockDb({ group: g, matched: 0 }).db, GID, "u3", { name: "X", managedBy: by });
		expect(await call(null)).toEqual({ status: "not_found" });
		expect(await call(group())).toEqual({ status: "forbidden" });
		const admin = (g: unknown, by: string) => addManagedMember(mockDb({ group: g, matched: 0 }).db, GID, "u1", { name: "X", managedBy: by });
		expect((await admin(group(), "m_ben")).status).toBe("invalid"); // outra pessoa sem login não pode ser responsável
		expect((await admin(group(), "fora")).status).toBe("invalid");
		const cheio = group(Array.from({ length: 50 }, (_, i) => (i === 0 ? member("u1", "admin") : member(`x${i}`))));
		expect(await admin(cheio, "x1")).toEqual({ status: "full" });
	});
	it("id malformado: not_found sem tocar no banco", async () => {
		const { db, groups } = mockDb();
		expect(await addManagedMember(db, "ruim", "u1", { name: "X", managedBy: "u2" })).toEqual({ status: "not_found" });
		expect(groups.updateOne).not.toHaveBeenCalled();
	});
});

describe("updateManagedMember", () => {
	it("filtro: alvo é sem login E (admin OU responsável atual); pixKey null vira $unset", async () => {
		const { db, groups } = mockDb();
		expect(await updateManagedMember(db, GID, "u2", "m_ben", { name: "Ben", pixKey: null })).toEqual({ status: "ok", uid: "m_ben" });
		const [filter, update, opts] = groups.updateOne.mock.calls[0];
		expect(filter.$and[0]).toEqual({ members: { $elemMatch: { uid: "m_ben", kind: "managed" } } });
		expect(JSON.stringify(filter.$and[1])).toContain('"managedBy":"u2"');
		expect(update.$set["members.$[t].name"]).toBe("Ben");
		expect(update.$unset).toEqual({ "members.$[t].pixKey": "" });
		expect(opts).toEqual({ arrayFilters: [{ "t.uid": "m_ben" }] });
	});
	it("trocar o responsável exige novo responsável real no mesmo update", async () => {
		const { db, groups } = mockDb();
		await updateManagedMember(db, GID, "u1", "m_ben", { managedBy: "u3" });
		expect(groups.updateOne.mock.calls[0][0].$and).toContainEqual({ members: { $elemMatch: { uid: "u3", kind: { $ne: "managed" } } } });
		expect(groups.updateOne.mock.calls[0][1].$set["members.$[t].managedBy"]).toBe("u3");
	});
	it("matriz: outro membro 403, não membro 404, alvo real/inexistente 404, responsável antigo 403", async () => {
		const miss = (actor: string, target: string, g: unknown = group(), patch = { name: "Z" }) =>
			updateManagedMember(mockDb({ group: g, matched: 0 }).db, GID, actor, target, patch);
		expect(await miss("u3", "m_ben")).toEqual({ status: "forbidden" });
		expect(await miss("x", "m_ben", null)).toEqual({ status: "not_found" });
		expect(await miss("u1", "u3")).toEqual({ status: "target_missing" });
		expect(await miss("u1", "m_nada")).toEqual({ status: "target_missing" });
		const trocado = group([member("u1", "admin"), member("u2"), member("u3"), managed("m_ben", "Benjamim", "u3")]);
		expect(await miss("u2", "m_ben", trocado)).toEqual({ status: "forbidden" }); // perdeu o acesso na hora
		expect((await miss("u1", "m_ben", group(), { managedBy: "m_ben" } as never)).status).toBe("invalid");
	});
});

describe("removeMember / setMemberRole com pessoas sem login", () => {
	it("admin remove pessoa sem login (convite revogado como hoje)", async () => {
		const { db, groups } = mockDb();
		expect(await removeMember(db, GID, "u1", "m_ben")).toEqual({ status: "ok" });
		const [filter, update] = groups.updateOne.mock.calls[0];
		expect(update.$pull).toEqual({ members: { uid: "m_ben" } });
		expect(update.$set.invite).toBeNull();
		expect(filter.$nor).toEqual([{ members: { $elemMatch: { managedBy: "m_ben" } } }]);
	});
	it("responsável não é removido: 'responsible' com os nomes (filtro atômico + releitura)", async () => {
		const { db, groups } = mockDb({ matched: 0, users: [{ _id: "u2", name: "Renata" }] });
		expect(await removeMember(db, GID, "u1", "u2")).toEqual({ status: "responsible", name: "Renata", managed: ["Benjamim"] });
		expect(groups.updateOne.mock.calls[0][0].$nor).toEqual([{ members: { $elemMatch: { managedBy: "u2" } } }]);
	});
	it("não admin não remove ninguém, nem o responsável remove a pessoa que cuida", async () => {
		expect(await removeMember(mockDb({ matched: 0 }).db, GID, "u2", "m_ben")).toEqual({ status: "forbidden" });
	});
	it("pessoa sem login não vira admin (filtro atômico + managed_target)", async () => {
		const { db, groups } = mockDb({ matched: 0 });
		expect(await setMemberRole(db, GID, "u1", "m_ben", "admin")).toEqual({ status: "managed_target" });
		expect(groups.updateOne.mock.calls[0][0].$nor).toEqual([{ members: { $elemMatch: { uid: "m_ben", kind: "managed" } } }]);
	});
});

describe("acceptInvite", () => {
	it("um uid m_* nunca entra nem age por convite", async () => {
		const { db, groups } = mockDb();
		expect(await acceptInvite(db, TOKEN, "m_ben")).toEqual({ status: "invalid" });
		expect(groups.findOneAndUpdate).not.toHaveBeenCalled();
	});
});
