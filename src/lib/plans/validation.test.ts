import { describe, expect, it } from "vitest";
import { cleanDetails, parseCloseInput, parseGuestName, parsePlanInput, parseResponseInput } from "./validation";

const NOW = new Date("2026-11-12T15:00:00Z");
const ok = (r: ReturnType<typeof parsePlanInput>) => (r.ok ? r.value : null);

describe("parsePlanInput", () => {
	it("aceita o mínimo e normaliza", () => {
		expect(ok(parsePlanInput({ name: "  Hotel  ", totalCents: 250000 }, NOW))).toEqual({ name: "Hotel", totalCents: 250000 });
	});
	it("aceita datas, detalhes e previsão de pessoas", () => {
		expect(ok(parsePlanInput({ name: "H", totalCents: 100, deadline: "2026-12-01", eventDate: "2026-12-28", details: "Link\r\nhttps://a.b", expectedPeople: 10 }, NOW))).toEqual({
			name: "H", totalCents: 100, deadline: "2026-12-01", eventDate: "2026-12-28", details: "Link\nhttps://a.b", expectedPeople: 10,
		});
	});
	it("campos vazios ou nulos são omitidos", () => {
		expect(ok(parsePlanInput({ name: "H", totalCents: 100, deadline: "", eventDate: null, details: "  ", expectedPeople: null }, NOW))).toEqual({ name: "H", totalCents: 100 });
	});
	it.each([
		[{ totalCents: 100 }, "name"],
		[{ name: "", totalCents: 100 }, "name"],
		[{ name: "x".repeat(81), totalCents: 100 }, "name"],
		[{ name: "H", totalCents: 0 }, "totalCents"],
		[{ name: "H", totalCents: 10.5 }, "totalCents"],
		[{ name: "H", totalCents: 100_000_001 }, "totalCents"],
		[{ name: "H", totalCents: "100" }, "totalCents"],
		[{ name: "H", totalCents: 100, deadline: "2026-02-30" }, "deadline"],
		[{ name: "H", totalCents: 100, eventDate: "1999-01-01" }, "eventDate"],
		[{ name: "H", totalCents: 100, eventDate: "2040-01-01" }, "eventDate"],
		[{ name: "H", totalCents: 100, details: "x".repeat(1001) }, "details"],
		[{ name: "H", totalCents: 100, expectedPeople: 1 }, "expectedPeople"],
		[{ name: "H", totalCents: 100, expectedPeople: 201 }, "expectedPeople"],
		[{ name: "H", totalCents: 100, expectedPeople: 3.5 }, "expectedPeople"],
	])("recusa %j", (body, field) => {
		const r = parsePlanInput(body, NOW);
		expect(r.ok).toBe(false);
		if (!r.ok) expect([r.status, r.field]).toEqual([422, field]);
	});
	it("recusa corpo que não é objeto", () => {
		expect(parsePlanInput(null, NOW).ok).toBe(false);
		expect(parsePlanInput([], NOW).ok).toBe(false);
	});
	it("aceita 1000 letras de detalhes", () => {
		expect(parsePlanInput({ name: "H", totalCents: 100, details: "é".repeat(1000) }, NOW).ok).toBe(true);
	});
});

describe("cleanDetails", () => {
	it("tira controles, normaliza quebras e limita linhas em branco", () => {
		expect(cleanDetails("a\u0000b\r\nc\r\n\r\n\r\n\r\n\r\nd")).toBe("ab\nc\n\n\nd");
	});
});

describe("parseResponseInput", () => {
	it("Vou sem limite, com limite, Não vou", () => {
		expect(parseResponseInput({ going: true })).toEqual({ ok: true, value: { going: true } });
		expect(parseResponseInput({ going: true, limitCents: 25000 })).toEqual({ ok: true, value: { going: true, limitCents: 25000 } });
		expect(parseResponseInput({ going: true, limitCents: null })).toEqual({ ok: true, value: { going: true } });
		expect(parseResponseInput({ going: false, limitCents: 5 })).toEqual({ ok: true, value: { going: false } });
		for (const same of [true, false, null, "x"]) expect(parseResponseInput({ going: true, sameAsShare: same, limitCents: 5 }).ok).toBe(false);
		expect(parseResponseInput({ going: true, sameAsShare: true })).toMatchObject({ ok: false, error: "Atualize a página e responda de novo." });
	});
	it("recusa limite inválido e corpo sem going", () => {
		for (const b of [{ going: true, limitCents: 0 }, { going: true, limitCents: -1 }, { going: true, limitCents: 1.5 }, { going: true, limitCents: "9" }, { going: true, limitCents: 1e12 }, {}, { going: "sim" }, null]) {
			expect(parseResponseInput(b).ok).toBe(false);
		}
	});
});

describe("parseGuestName", () => {
	it("limpa espaços e limita o tamanho", () => {
		expect(parseGuestName({ name: "  Tio   Zé " })).toEqual({ ok: true, value: "Tio Zé" });
		expect(parseGuestName({ name: "" }).ok).toBe(false);
		expect(parseGuestName({ name: "x".repeat(41) }).ok).toBe(false);
		expect(parseGuestName(null).ok).toBe(false);
	});
});

describe("parseCloseInput", () => {
	const plan = { name: "Hotel", totalCents: 250000 };
	const body = { groupName: " Viagem ", participantIds: ["a", "b"], paidBy: "a", date: "2026-11-12" };
	it("usa o valor e a descrição do plano e valida como o lançamento", () => {
		expect(parseCloseInput(body, plan, NOW)).toEqual({ ok: true, value: { groupName: "Viagem", participantIds: ["a", "b"], createExpense: true, paidBy: "a", date: "2026-11-12" } });
		const card = parseCloseInput({ ...body, dueDate: "2026-12-10" }, plan, NOW);
		expect(card.ok && card.value.dueDate).toBe("2026-12-10");
	});
	it("recusa nome vazio, pagador fora da divisão, divisão vazia ou repetida, data no futuro", () => {
		const bad = (over: object) => parseCloseInput({ ...body, ...over }, plan, NOW);
		expect(bad({ groupName: " " }).ok).toBe(false);
		expect(bad({ groupName: "x".repeat(61) }).ok).toBe(false);
		expect(bad({ paidBy: "z" }).ok).toBe(false);
		expect(bad({ paidBy: undefined }).ok).toBe(false);
		const empty = bad({ participantIds: [] });
		expect(!empty.ok && empty.field).toBe("participantIds");
		expect(bad({ participantIds: ["a", "a"] }).ok).toBe(false);
		expect(bad({ date: "2030-01-01" }).ok).toBe(false);
		expect(parseCloseInput(null, plan, NOW).ok).toBe(false);
	});
	it("createExpense: ausente vale true; false e true explícitos; outro tipo é 422", () => {
		expect(parseCloseInput(body, plan, NOW)).toMatchObject({ ok: true, value: { createExpense: true } });
		expect(parseCloseInput({ ...body, createExpense: true }, plan, NOW)).toMatchObject({ ok: true, value: { createExpense: true, paidBy: "a" } });
		for (const bad of ["false", 0, 1, null, "sim", {}, []]) {
			const r = parseCloseInput({ ...body, createExpense: bad }, plan, NOW);
			expect(r).toMatchObject({ ok: false, status: 422, field: "createExpense" });
		}
	});
	it("só-grupo: não pede pagador nem data, ignora o que vier deles e ainda valida quem entra", () => {
		const only = parseCloseInput({ groupName: "Sítio", participantIds: ["a", "b"], createExpense: false }, plan, NOW);
		expect(only).toEqual({ ok: true, value: { groupName: "Sítio", participantIds: ["a", "b"], createExpense: false } });
		const ignored = parseCloseInput({ ...body, createExpense: false, paidBy: "zzz", date: "2030-01-01", dueDate: "lixo" }, plan, NOW);
		expect(ignored).toEqual({ ok: true, value: { groupName: "Viagem", participantIds: ["a", "b"], createExpense: false } });
		const empty = parseCloseInput({ groupName: "x", participantIds: [], createExpense: false }, plan, NOW);
		expect(!empty.ok && empty.field).toBe("participantIds");
		expect(parseCloseInput({ groupName: "x", participantIds: ["a", "a"], createExpense: false }, plan, NOW).ok).toBe(false);
		expect(parseCloseInput({ groupName: " ", participantIds: ["a"], createExpense: false }, plan, NOW).ok).toBe(false);
	});
});
