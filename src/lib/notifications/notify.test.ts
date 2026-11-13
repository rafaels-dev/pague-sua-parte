import { describe, expect, it, vi } from "vitest";
import { EmailError } from "./email";
import { notify, runPool, runSettledInOrder, sendEmailWithRetry } from "./notify";

describe("runPool", () => {
	it("nunca passa do limite de tarefas simultâneas", async () => {
		let running = 0;
		let peak = 0;
		const task = async () => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((r) => setTimeout(r, 5));
			running--;
		};
		await runPool(Array.from({ length: 7 }, () => task), 2);
		expect(peak).toBe(2);
	});
});

describe("sendEmailWithRetry", () => {
	const noSleep = () => Promise.resolve();
	it("429: tenta de novo uma vez", async () => {
		const send = vi.fn().mockRejectedValueOnce(new EmailError("x", 429, 1)).mockResolvedValueOnce(true);
		await sendEmailWithRetry(send, Date.now() + 10_000, noSleep);
		expect(send).toHaveBeenCalledTimes(2);
	});
	it("429 de novo: desiste", async () => {
		const send = vi.fn().mockRejectedValue(new EmailError("x", 429));
		await expect(sendEmailWithRetry(send, Date.now() + 10_000, noSleep)).rejects.toBeInstanceOf(EmailError);
		expect(send).toHaveBeenCalledTimes(2);
	});
	it("sem tempo sobrando, não tenta de novo", async () => {
		const send = vi.fn().mockRejectedValue(new EmailError("x", 429, 2));
		await expect(sendEmailWithRetry(send, Date.now() + 500, noSleep)).rejects.toBeInstanceOf(EmailError);
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("outros erros não repetem", async () => {
		const send = vi.fn().mockRejectedValue(new EmailError("x", 500));
		await expect(sendEmailWithRetry(send, Date.now() + 10_000, noSleep)).rejects.toThrow();
		expect(send).toHaveBeenCalledTimes(1);
	});
});

describe("runSettledInOrder", () => {
	it("o primeiro lança e o segundo ainda roda, em ordem", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const order: string[] = [];
		await runSettledInOrder([
			async () => {
				order.push("a");
				throw new Error("banco fora");
			},
			async () => void order.push("b"),
		]);
		expect(order).toEqual(["a", "b"]);
		expect(log).toHaveBeenCalledTimes(1);
		log.mockRestore();
	});
	it("o segundo lança e o primeiro já saiu", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const order: string[] = [];
		await runSettledInOrder([
			async () => void order.push("a"),
			async () => {
				throw new Error("x");
			},
		]);
		expect(order).toEqual(["a"]);
		log.mockRestore();
	});
});

describe("notify: aviso só de e-mail não consulta push", () => {
	it("não lê inscrições para emailOnly, mas lê para os demais", async () => {
		vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "k");
		vi.stubEnv("VAPID_PRIVATE_KEY", "k");
		vi.stubEnv("VAPID_SUBJECT", "mailto:a@b.com");
		const asked: unknown[] = [];
		const db = {
			collection: (name: string) => ({
				find: (q: unknown) => ({ toArray: async () => (asked.push([name, q]), []) }),
			}),
		} as never;
		const n = { uid: "u1", title: "t", body: "b", url: "/app" };
		await notify(db, [{ ...n, emailOnly: true }]);
		expect(asked.filter((a) => (a as string[])[0] === "push_subscriptions")).toEqual([]);
		await notify(db, [{ ...n, emailOnly: true }, { ...n, uid: "u2" }]);
		const subs = asked.filter((a) => (a as string[])[0] === "push_subscriptions") as [string, { uid: { $in: string[] } }][];
		expect(subs).toHaveLength(1);
		expect(subs[0][1].uid.$in).toEqual(["u2"]);
		vi.unstubAllEnvs();
	});
});
