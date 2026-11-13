import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPush = vi.fn().mockResolvedValue("sent");
vi.mock("./push", () => ({ pushConfigured: () => true, sendPush }));
const { notify } = await import("./notify");

const notice = { uid: "u1", title: "t", body: "b", url: "/app/x" };

function fakeDb(insertMany: ReturnType<typeof vi.fn>) {
	return {
		collection: (name: string) => {
			if (name === "inbox") return { insertMany };
			if (name === "users") return { find: () => ({ toArray: async () => [{ _id: "u1", notify: { push: true } }] }) };
			return { find: () => ({ toArray: async () => [{ uid: "u1", endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "p", auth: "a" } }] }), deleteMany: async () => ({}) };
		},
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("notify grava na caixa de avisos", () => {
	it("grava antes do envio, um lote só, e o push sai", async () => {
		const insertMany = vi.fn().mockResolvedValue({});
		const rep = await notify(fakeDb(insertMany), [notice, { ...notice, uid: "u2" }, { ...notice, emailOnly: true }]);
		expect(insertMany).toHaveBeenCalledTimes(1);
		expect(insertMany.mock.calls[0][0]).toHaveLength(2);
		expect(sendPush).toHaveBeenCalled();
		expect(rep.delivered).toBeGreaterThanOrEqual(1);
	});
	it("falha ao gravar na caixa não impede o push", async () => {
		const insertMany = vi.fn().mockRejectedValue(new Error("banco caiu"));
		const rep = await notify(fakeDb(insertMany), [notice]);
		expect(insertMany).toHaveBeenCalled();
		expect(sendPush).toHaveBeenCalledTimes(1);
		expect(rep.delivered).toBe(1);
	});
	it("grava mesmo com o envio falhando", async () => {
		sendPush.mockRejectedValueOnce(new Error("Falha no push (500)"));
		const insertMany = vi.fn().mockResolvedValue({});
		const rep = await notify(fakeDb(insertMany), [notice]);
		expect(insertMany).toHaveBeenCalledTimes(1);
		expect(rep.failed).toBe(1);
	});
	it("só e-mail (boas-vindas) não grava", async () => {
		const insertMany = vi.fn();
		await notify(fakeDb(insertMany), [{ ...notice, emailOnly: true }]);
		expect(insertMany).not.toHaveBeenCalled();
	});
});

describe("a caixa não atrasa nem derruba o envio", () => {
	it("insertMany que nunca resolve: o push sai e notify termina no prazo", async () => {
		const insertMany = vi.fn().mockReturnValue(new Promise(() => undefined));
		const t = Date.now();
		const rep = await notify(fakeDb(insertMany), [notice], { deadline: t + 3000 });
		expect(sendPush).toHaveBeenCalledTimes(1);
		expect(rep.delivered).toBe(1);
		expect(Date.now() - t).toBeLessThan(3400); // termina no prazo, não 4 s depois
	});
	it("o envio começa antes de a gravação acabar", async () => {
		let release: () => void = () => undefined;
		const insertMany = vi.fn().mockReturnValue(new Promise<void>((r) => (release = r)));
		sendPush.mockImplementationOnce(async () => {
			release(); // só libera a caixa depois de o push já ter começado
			return "sent";
		});
		const rep = await notify(fakeDb(insertMany), [notice], { deadline: Date.now() + 5000 });
		expect(rep.delivered).toBe(1);
	});
	it("insertMany que rejeita depois: sem rejeição solta, envio normal", async () => {
		const insertMany = vi.fn().mockReturnValue(new Promise((_, rej) => setTimeout(() => rej(new Error("tarde")), 20)));
		const rep = await notify(fakeDb(insertMany), [notice], { deadline: Date.now() + 4000 });
		expect(rep.delivered).toBe(1);
		await new Promise((r) => setTimeout(r, 50));
	});
	it("prazo já vencido: não espera a caixa", async () => {
		const insertMany = vi.fn().mockReturnValue(new Promise(() => undefined));
		const t = Date.now();
		await notify(fakeDb(insertMany), [notice], { deadline: Date.now() - 1 });
		expect(Date.now() - t).toBeLessThan(500);
	});
});
