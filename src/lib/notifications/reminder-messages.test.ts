import { describe, expect, it } from "vitest";
import type { ReminderItem } from "@/lib/reminders/plan";
import { buildReminderNotice } from "./reminder-messages";

const item = (o: Partial<ReminderItem> = {}): ReminderItem => ({ recurrenceId: "r", groupId: "g1", groupName: "Casa", period: "2026-11", lead: 7, uid: "ana", description: "Internet", dueDate: "2026-11-20", amountCents: 4990, exists: false, own: true, others: false, ...o });

describe("buildReminderNotice", () => {
	it("15, 7 e 3 dias: 'vence em N dias, no dia dd/mm'; no dia: 'vence hoje'", () => {
		for (const lead of [15, 7, 3] as const) {
			const n = buildReminderNotice(item({ lead }));
			expect(n.body).toBe(`"Internet" (Casa) vence em ${lead} dias, no dia 20/11. Sua parte: R$ 49,90`);
			expect(n.subject).toBe(`Lembrete: "Internet" vence em ${lead} dias · R$ 49,90`);
		}
		const hoje = buildReminderNotice(item({ lead: 0 }));
		expect(hoje.body).toBe('"Internet" (Casa) vence hoje. Sua parte: R$ 49,90');
		expect(hoje.subject).toBe('Lembrete: "Internet" vence hoje · R$ 49,90');
		expect(hoje.body).not.toContain("dd");
	});
	it("despesa criada: 'Falta pagar' e link da despesa; prevista: parte prevista e link do grupo", () => {
		const criada = buildReminderNotice(item({ exists: true, expenseId: "e9", amountCents: 2000 }));
		expect([criada.amountLabel, criada.url, criada.body]).toEqual(["Falta pagar", "/app/grupos/g1/despesas/e9", '"Internet" (Casa) vence em 7 dias, no dia 20/11. Falta pagar: R$ 20,00']);
		const prevista = buildReminderNotice(item());
		expect([prevista.amountLabel, prevista.url]).toEqual(["Sua parte", "/app/grupos/g1"]);
	});
	it("pessoa cuidada: legenda e texto verdadeiros nos três casos, criada ou prevista", () => {
		const labels = (exists: boolean) => [item({ own: true, others: false }), item({ own: false, others: true }), item({ own: true, others: true })].map((i) => buildReminderNotice({ ...i, exists }).amountLabel);
		expect(labels(false)).toEqual(["Sua parte", "Parte de quem você cuida", "Sua parte e de quem você cuida"]);
		expect(labels(true)).toEqual(["Falta pagar", "Falta pagar da parte de quem você cuida", "Falta pagar, sua parte e de quem você cuida"]);
		const n = buildReminderNotice(item({ own: false, others: true }));
		expect(n.body).toContain("Parte de quem você cuida: R$ 49,90");
		expect(n.body).not.toMatch(/Sua parte/);
	});
	it("contrato do e-mail: scope do grupo, valor com legenda, push sem Pix nem dados extras", () => {
		const n = buildReminderNotice(item());
		expect(n).toMatchObject({ title: "Lembrete de vencimento", scope: { kind: "group", name: "Casa" }, amountCents: 4990 });
		expect(JSON.stringify(n)).not.toMatch(/pix|token|receipts/i);
		expect(n.body).not.toBe(n.subject);
	});
	it("nomes longos: corpo cortado, assunto até 80 com o valor inteiro", () => {
		const n = buildReminderNotice(item({ description: "😀".repeat(100), groupName: "G".repeat(200), amountCents: 100_000_000 }));
		expect(n.subject!.length).toBeLessThanOrEqual(80);
		expect(n.subject).toContain("R$ 1.000.000,00");
		expect(n.body.length).toBeLessThan(200);
	});
});
