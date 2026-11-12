import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { removeSubscription, saveSubscription, subscriptionSchema } from "./subscriptions";

const keys = { p256dh: "p", auth: "a" };

describe("subscriptionSchema", () => {
	it("só aceita endereço https", () => {
		expect(subscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/abc", keys }).success).toBe(true);
		expect(subscriptionSchema.safeParse({ endpoint: "http://push.example/abc", keys }).success).toBe(false);
		expect(subscriptionSchema.safeParse({ endpoint: "lixo", keys }).success).toBe(false);
		expect(subscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/" + "a".repeat(1000), keys }).success).toBe(false);
	});
});

function mockDb(extra: { _id: string }[] = []) {
	const toArray = vi.fn().mockResolvedValue(extra);
	const find = vi.fn().mockReturnValue({ sort: () => ({ skip: () => ({ toArray }) }) });
	const col = { updateOne: vi.fn(), find, deleteMany: vi.fn(), deleteOne: vi.fn() };
	return { db: { collection: () => col } as unknown as Db, col };
}

describe("saveSubscription", () => {
	it("faz upsert pelo endereço e passa para o usuário atual", async () => {
		const { db, col } = mockDb();
		await saveSubscription(db, "u2", { endpoint: "https://fcm.googleapis.com/abc", keys });
		const [filter, update, opts] = col.updateOne.mock.calls[0];
		expect(filter).toEqual({ endpoint: "https://fcm.googleapis.com/abc" });
		expect(update.$set.uid).toBe("u2");
		expect(update.$set.createdAt).toBeInstanceOf(Date);
		expect(opts).toEqual({ upsert: true });
		expect(col.deleteMany).not.toHaveBeenCalled();
	});
	it("apaga o que passar de 10 por usuário", async () => {
		const { db, col } = mockDb([{ _id: "x" }]);
		await saveSubscription(db, "u2", { endpoint: "https://fcm.googleapis.com/abc", keys });
		expect(col.deleteMany).toHaveBeenCalledWith({ _id: { $in: ["x"] }, uid: "u2" });
	});
	it("duplo clique: erro 11000 repete uma vez e dá certo", async () => {
		const { db, col } = mockDb();
		col.updateOne.mockRejectedValueOnce({ code: 11000 }).mockResolvedValueOnce({});
		await saveSubscription(db, "u2", { endpoint: "https://fcm.googleapis.com/abc", keys });
		expect(col.updateOne).toHaveBeenCalledTimes(2);
	});
	it("outro erro continua falhando", async () => {
		const { db, col } = mockDb();
		col.updateOne.mockRejectedValue(new Error("boom"));
		await expect(saveSubscription(db, "u2", { endpoint: "https://fcm.googleapis.com/abc", keys })).rejects.toThrow("boom");
	});
	it("remover só vale para o dono", async () => {
		const { db, col } = mockDb();
		await removeSubscription(db, "u1", "https://e");
		expect(col.deleteOne).toHaveBeenCalledWith({ uid: "u1", endpoint: "https://e" });
	});
});
