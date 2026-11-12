import { describe, expect, it, vi } from "vitest";
import { EmailError } from "./email";
import { runPool, sendEmailWithRetry } from "./notify";

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
