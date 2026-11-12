import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { updateNotifyPrefs, updateProfile, upsertFromAuth } from "./repo";

function mockDb(result: unknown) {
	const findOneAndUpdate = vi.fn().mockResolvedValue(result);
	const collection = vi.fn().mockReturnValue({ findOneAndUpdate });
	return { db: { collection } as unknown as Db, findOneAndUpdate, collection };
}

const authUser = { uid: "u1", email: "a@b.com", emailVerified: true, name: "Ana", picture: "http://x/p.png" };

describe("upsertFromAuth", () => {
	it("faz upsert em users com _id = uid e nunca toca em pixKey", async () => {
		const doc = { _id: "u1" };
		const { db, findOneAndUpdate, collection } = mockDb(doc);
		expect(await upsertFromAuth(db, authUser)).toBe(doc);
		expect(collection).toHaveBeenCalledWith("users");
		const [filter, update, opts] = findOneAndUpdate.mock.calls[0];
		expect(filter).toEqual({ _id: "u1" });
		expect(opts).toMatchObject({ upsert: true, returnDocument: "after" });
		expect(update.$set).toMatchObject({ email: "a@b.com", emailVerified: true, name: "Ana", picture: "http://x/p.png" });
		expect(update.$set.updatedAt).toBeInstanceOf(Date);
		expect(update.$setOnInsert.createdAt).toBeInstanceOf(Date);
		const touched = JSON.stringify(update);
		expect(touched).not.toContain("pixKey");
		expect(touched).not.toContain("displayName");
	});
	it("remove a foto quando o usuário não tem", async () => {
		const { db, findOneAndUpdate } = mockDb({});
		await upsertFromAuth(db, { ...authUser, picture: undefined });
		const update = findOneAndUpdate.mock.calls[0][1];
		expect(update.$set).not.toHaveProperty("picture");
		expect(update.$unset).toEqual({ picture: "" });
	});
	it("falha se nada voltar", async () => {
		const { db } = mockDb(null);
		await expect(upsertFromAuth(db, authUser)).rejects.toThrow();
	});
});

describe("updateProfile", () => {
	it("atualiza só o uid informado e os campos enviados", async () => {
		const { db, findOneAndUpdate } = mockDb({ _id: "u1" });
		await updateProfile(db, "u1", { displayName: "Aninha", pixKey: { type: "cpf", key: "52998224725" } });
		const [filter, update, opts] = findOneAndUpdate.mock.calls[0];
		expect(filter).toEqual({ _id: "u1" });
		expect(opts).not.toHaveProperty("upsert");
		expect(update.$set).toMatchObject({ displayName: "Aninha", pixKey: { type: "cpf", key: "52998224725" } });
		expect(update.$unset).toBeUndefined();
	});
	it("não altera o que não foi enviado", async () => {
		const { db, findOneAndUpdate } = mockDb({});
		await updateProfile(db, "u1", { displayName: "X" });
		expect(Object.keys(findOneAndUpdate.mock.calls[0][1].$set).sort()).toEqual(["displayName", "updatedAt"]);
	});
	it("pixKey null remove a chave", async () => {
		const { db, findOneAndUpdate } = mockDb({});
		await updateProfile(db, "u1", { pixKey: null });
		const update = findOneAndUpdate.mock.calls[0][1];
		expect(update.$unset).toEqual({ pixKey: "" });
		expect(update.$set).not.toHaveProperty("pixKey");
	});
});

describe("updateNotifyPrefs", () => {
	it("grava só o que foi enviado", async () => {
		const { db, findOneAndUpdate } = mockDb({});
		await updateNotifyPrefs(db, "u1", { email: false });
		expect(Object.keys(findOneAndUpdate.mock.calls[0][1].$set).sort()).toEqual(["notify.email", "updatedAt"]);
	});
});
