import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { acceptInvite, createGroup, getGroupDetail, getOrCreateInvite, listGroups, previewInvite, removeMember, setMemberRole } from "./repo";

const GID = "507f1f77bcf86cd799439011";
const TOKEN = "t".repeat(43);
const future = () => new Date(Date.now() + 3600_000);
const past = () => new Date(Date.now() - 3600_000);
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const group = (extra: Record<string, unknown> = {}) => ({
	_id: new ObjectId(GID),
	name: "Viagem",
	createdBy: "u1",
	members: [member("u1", "admin"), member("u2")],
	invite: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	...extra,
});

function mockDb(opts: {
	groups?: Record<string, unknown>;
	users?: unknown[];
	balanceRows?: unknown[];
}) {
	const groups = {
		findOne: vi.fn(),
		find: vi.fn(),
		insertOne: vi.fn(),
		updateOne: vi.fn(),
		findOneAndUpdate: vi.fn(),
		...opts.groups,
	};
	const usersToArray = vi.fn().mockResolvedValue(opts.users ?? []);
	const users = { find: vi.fn().mockReturnValue({ toArray: usersToArray }) };
	const expenses = { aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(opts.balanceRows ?? []) }) };
	const db = {
		collection: vi.fn((name: string) => (name === "groups" ? groups : name === "expenses" ? expenses : users)),
	} as unknown as Db;
	return { db, groups, users, expenses };
}

describe("createGroup", () => {
	it("cria com o criador como primeiro membro admin", async () => {
		const { db, groups } = mockDb({});
		groups.insertOne.mockResolvedValue({ insertedId: new ObjectId(GID) });
		const res = await createGroup(db, "u1", "Viagem");
		expect(res).toEqual({ id: GID, name: "Viagem", memberCount: 1, role: "admin" });
		const doc = groups.insertOne.mock.calls[0][0];
		expect(doc.members).toHaveLength(1);
		expect(doc).toMatchObject({ createdBy: "u1", invite: null, members: [{ uid: "u1", role: "admin" }] });
	});
});

describe("listGroups", () => {
	it("filtra por membro, mais novos primeiro, e informa o papel (saldo zero sem despesas)", async () => {
		const toArray = vi.fn().mockResolvedValue([group()]);
		const sort = vi.fn().mockReturnValue({ toArray });
		const { db, groups } = mockDb({});
		groups.find.mockReturnValue({ sort });
		expect(await listGroups(db, "u2")).toEqual([
			{ id: GID, name: "Viagem", memberCount: 2, role: "member", toReceiveCents: 0, toPayCents: 0 },
		]);
		expect(groups.find).toHaveBeenCalledWith({ "members.uid": "u2" });
		expect(sort.mock.calls[0][0]).toMatchObject({ createdAt: -1 });
	});
});

describe("listGroups: saldos", () => {
	it("uma única agregação para todos os grupos e saldo por grupo", async () => {
		const g2 = { ...group(), _id: new ObjectId("507f1f77bcf86cd799439099"), name: "Casa" };
		const sort = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([group(), g2]) });
		const { db, groups, expenses } = mockDb({ balanceRows: [{ _id: new ObjectId(GID), toPay: 300, toReceive: 1200 }] });
		groups.find.mockReturnValue({ sort });
		const list = await listGroups(db, "u2");
		expect(expenses.aggregate).toHaveBeenCalledTimes(1);
		expect(expenses.aggregate.mock.calls[0][0][0].$match.groupId.$in).toHaveLength(2);
		expect(list.map((g) => [g.toReceiveCents, g.toPayCents])).toEqual([[1200, 300], [0, 0]]);
	});
	it("sem grupos, nem consulta despesas", async () => {
		const { db, groups, expenses } = mockDb({});
		groups.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) });
		expect(await listGroups(db, "u2")).toEqual([]);
		expect(expenses.aggregate).not.toHaveBeenCalled();
	});
});

describe("getGroupDetail", () => {
	it("id malformado: null sem consultar o banco", async () => {
		const { db, groups } = mockDb({});
		expect(await getGroupDetail(db, "xyz", "u1")).toBeNull();
		expect(groups.findOne).not.toHaveBeenCalled();
	});
	it("não membro (ou inexistente): null", async () => {
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(null);
		expect(await getGroupDetail(db, GID, "intruso")).toBeNull();
		expect(groups.findOne.mock.calls[0][0]).toMatchObject({ "members.uid": "intruso" });
	});
	it("monta membros sem e-mail nem chave Pix, admins primeiro", async () => {
		const { db, users } = mockDb({
			users: [
				{ _id: "u1", name: "Zeca", displayName: "Ana", picture: "http://x/a.png", pixKey: { type: "cpf", key: "1" }, email: "a@b.com" },
				{ _id: "u2", name: "Bia" },
			],
		});
		(db.collection("groups").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(group());
		const res = await getGroupDetail(db, GID, "u2");
		expect(res).toEqual({
			id: GID,
			name: "Viagem",
			role: "member",
			members: [
				{ uid: "u1", name: "Ana", picture: "http://x/a.png", role: "admin", hasPixKey: true, isYou: false },
				{ uid: "u2", name: "Bia", picture: null, role: "member", hasPixKey: false, isYou: true },
			],
		});
		const json = JSON.stringify(res);
		expect(json).not.toContain("a@b.com");
		expect(json).not.toContain("pixKey");
		expect(json).not.toContain("email");
		expect(users.find.mock.calls[0][1].projection).not.toHaveProperty("email");
	});
});

describe("getOrCreateInvite", () => {
	it("não membro: not_found", async () => {
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(null);
		expect(await getOrCreateInvite(db, GID, "x", false)).toEqual({ status: "not_found" });
	});
	it("id malformado: not_found", async () => {
		const { db } = mockDb({});
		expect(await getOrCreateInvite(db, "nope", "u1", false)).toEqual({ status: "not_found" });
	});
	it("devolve o link vigente sem gravar", async () => {
		const expiresAt = future();
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(group({ invite: { token: TOKEN, expiresAt } }));
		expect(await getOrCreateInvite(db, GID, "u2", false)).toEqual({ status: "ok", token: TOKEN, expiresAt });
		expect(groups.updateOne).not.toHaveBeenCalled();
	});
	it("link expirado: cria novo (7 dias) por update condicional", async () => {
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(group({ invite: { token: TOKEN, expiresAt: past() } }));
		groups.updateOne.mockResolvedValue({ matchedCount: 1 });
		const res = await getOrCreateInvite(db, GID, "u2", false);
		expect(res.status).toBe("ok");
		if (res.status !== "ok") return;
		expect(res.token).not.toBe(TOKEN);
		expect(res.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
		expect(groups.updateOne.mock.calls[0][0].$or).toBeDefined();
	});
	it("perdeu a corrida: devolve o link criado por outra requisição", async () => {
		const expiresAt = future();
		const { db, groups } = mockDb({});
		groups.findOne
			.mockResolvedValueOnce(group())
			.mockResolvedValueOnce(group({ invite: { token: TOKEN, expiresAt } }));
		groups.updateOne.mockResolvedValue({ matchedCount: 0 });
		expect(await getOrCreateInvite(db, GID, "u2", false)).toEqual({ status: "ok", token: TOKEN, expiresAt });
	});
	it("regenerate por não admin: forbidden", async () => {
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(group());
		expect(await getOrCreateInvite(db, GID, "u2", true)).toEqual({ status: "forbidden" });
		expect(groups.updateOne).not.toHaveBeenCalled();
	});
	it("regenerate por admin: troca o token mesmo com link vigente", async () => {
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(group({ invite: { token: TOKEN, expiresAt: future() } }));
		groups.updateOne.mockResolvedValue({ matchedCount: 1 });
		const res = await getOrCreateInvite(db, GID, "u1", true);
		expect(res.status === "ok" && res.token !== TOKEN).toBe(true);
		expect(groups.updateOne.mock.calls[0][0].members).toEqual({ $elemMatch: { uid: "u1", role: "admin" } });
	});
});

describe("previewInvite", () => {
	it("convite válido", async () => {
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(group());
		expect(await previewInvite(db, TOKEN, "u2")).toEqual({
			groupId: GID,
			groupName: "Viagem",
			memberCount: 2,
			alreadyMember: true,
		});
		const filter = groups.findOne.mock.calls[0][0];
		expect(filter["invite.token"]).toBe(TOKEN);
		expect(filter["invite.expiresAt"].$gt).toBeInstanceOf(Date);
	});
	it("inválido ou expirado: null", async () => {
		const { db, groups } = mockDb({});
		groups.findOne.mockResolvedValue(null);
		expect(await previewInvite(db, TOKEN, "u2")).toBeNull();
		expect(await previewInvite(db, "lixo!", "u2")).toBeNull();
	});
});

describe("acceptInvite", () => {
	it("entra com um único update atômico (token, validade, ainda fora, limite)", async () => {
		const { db, groups } = mockDb({});
		groups.findOneAndUpdate.mockResolvedValue({ _id: new ObjectId(GID) });
		expect(await acceptInvite(db, TOKEN, "u3")).toEqual({ status: "ok", groupId: GID });
		const [filter, update] = groups.findOneAndUpdate.mock.calls[0];
		expect(filter["invite.token"]).toBe(TOKEN);
		expect(filter["invite.expiresAt"].$gt).toBeInstanceOf(Date);
		expect(filter["members.uid"]).toEqual({ $ne: "u3" });
		expect(filter["members.49"]).toEqual({ $exists: false });
		expect(update.$push.members).toMatchObject({ uid: "u3", role: "member" });
	});
	it("idempotente: já é membro", async () => {
		const { db, groups } = mockDb({});
		groups.findOneAndUpdate.mockResolvedValue(null);
		groups.findOne.mockResolvedValue(group());
		expect(await acceptInvite(db, TOKEN, "u2")).toEqual({ status: "ok", groupId: GID });
	});
	it("convite expirado ou inexistente: invalid", async () => {
		const { db, groups } = mockDb({});
		groups.findOneAndUpdate.mockResolvedValue(null);
		groups.findOne.mockResolvedValue(null);
		expect(await acceptInvite(db, TOKEN, "u3")).toEqual({ status: "invalid" });
		expect(await acceptInvite(db, "x", "u3")).toEqual({ status: "invalid" });
	});
	it("grupo cheio: full", async () => {
		const { db, groups } = mockDb({});
		groups.findOneAndUpdate.mockResolvedValue(null);
		groups.findOne.mockResolvedValue(group());
		expect(await acceptInvite(db, TOKEN, "u3")).toEqual({ status: "full" });
	});
});

describe("setMemberRole / removeMember", () => {
	const matched = { matchedCount: 1 };
	const none = { matchedCount: 0 };

	it("promove com um update atômico cujo filtro exige que quem age seja admin", async () => {
		const { db, groups } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue(matched) } });
		expect(await setMemberRole(db, GID, "u1", "u2", "admin")).toEqual({ status: "ok" });
		const [filter, update, opts] = groups.updateOne.mock.calls[0];
		expect(filter).toMatchObject({
			_id: new ObjectId(GID),
			members: { $elemMatch: { uid: "u1", role: "admin" } },
			"members.uid": "u2",
		});
		expect(update.$set["members.$[t].role"]).toBe("admin");
		expect(opts).toEqual({ arrayFilters: [{ "t.uid": "u2" }] });
		expect(groups.findOne).not.toHaveBeenCalled();
	});
	it("rebaixa", async () => {
		const { db, groups } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue(matched) } });
		expect(await setMemberRole(db, GID, "u1", "u2", "member")).toEqual({ status: "ok" });
		expect(groups.updateOne.mock.calls[0][1].$set["members.$[t].role"]).toBe("member");
	});
	it("é idempotente: papel já igual (matched, não modified) continua ok", async () => {
		const { db } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 }) } });
		expect(await setMemberRole(db, GID, "u1", "u2", "member")).toEqual({ status: "ok" });
	});
	it("remove com $pull e o mesmo filtro de admin", async () => {
		const { db, groups } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue(matched) } });
		expect(await removeMember(db, GID, "u1", "u2")).toEqual({ status: "ok" });
		const [filter, update] = groups.updateOne.mock.calls[0];
		expect(filter.members).toEqual({ $elemMatch: { uid: "u1", role: "admin" } });
		expect(filter["members.uid"]).toBe("u2");
		expect(update.$pull).toEqual({ members: { uid: "u2" } });
		// O convite vigente é revogado junto com a remoção.
		expect(update.$set.invite).toBeNull();
	});
	it("id malformado: not_found sem consultar o banco", async () => {
		const { db, groups } = mockDb({});
		expect(await setMemberRole(db, "ruim", "u1", "u2", "admin")).toEqual({ status: "not_found" });
		expect(await removeMember(db, "ruim", "u1", "u2")).toEqual({ status: "not_found" });
		expect(groups.updateOne).not.toHaveBeenCalled();
		expect(groups.findOne).not.toHaveBeenCalled();
	});
	it("não membro: not_found", async () => {
		const { db } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue(none), findOne: vi.fn().mockResolvedValue(null) } });
		expect(await setMemberRole(db, GID, "x", "u2", "admin")).toEqual({ status: "not_found" });
		expect(await removeMember(db, GID, "x", "u2")).toEqual({ status: "not_found" });
	});
	it("membro comum: forbidden", async () => {
		const { db } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue(none), findOne: vi.fn().mockResolvedValue(group()) } });
		expect(await setMemberRole(db, GID, "u2", "u1", "member")).toEqual({ status: "forbidden" });
		expect(await removeMember(db, GID, "u2", "u1")).toEqual({ status: "forbidden" });
	});
	it("admin rebaixado no meio da corrida: forbidden", async () => {
		const g = group({ members: [member("u1"), member("u2", "admin")] });
		const { db } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue(none), findOne: vi.fn().mockResolvedValue(g) } });
		expect(await removeMember(db, GID, "u1", "u2")).toEqual({ status: "forbidden" });
	});
	it("a si mesmo: self, sem tentar atualizar", async () => {
		const { db, groups } = mockDb({ groups: { findOne: vi.fn().mockResolvedValue(group()) } });
		expect(await setMemberRole(db, GID, "u1", "u1", "member")).toEqual({ status: "self" });
		expect(await removeMember(db, GID, "u1", "u1")).toEqual({ status: "self" });
		expect(groups.updateOne).not.toHaveBeenCalled();
	});
	it("a si mesmo sendo membro comum: forbidden; sendo estranho: not_found", async () => {
		const m = mockDb({ groups: { findOne: vi.fn().mockResolvedValue(group()) } });
		expect(await removeMember(m.db, GID, "u2", "u2")).toEqual({ status: "forbidden" });
		const s = mockDb({ groups: { findOne: vi.fn().mockResolvedValue(null) } });
		expect(await removeMember(s.db, GID, "x", "x")).toEqual({ status: "not_found" });
	});
	it("alvo que não é (mais) membro: target_missing", async () => {
		const { db } = mockDb({ groups: { updateOne: vi.fn().mockResolvedValue(none), findOne: vi.fn().mockResolvedValue(group()) } });
		expect(await setMemberRole(db, GID, "u1", "zz", "admin")).toEqual({ status: "target_missing" });
		expect(await removeMember(db, GID, "u1", "zz")).toEqual({ status: "target_missing" });
	});
});
