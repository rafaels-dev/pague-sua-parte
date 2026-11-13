import { describe, expect, it } from "vitest";
import { badgeLabel, bellLabel, groupByDay, relativeTime, type InboxItem } from "./inbox";

const item = (id: string, createdAt: string): InboxItem => ({ id, title: id, body: "", url: "/app", createdAt, read: false });
// 13/11/2026 14:00 em São Paulo (UTC-3)
const NOW = new Date("2026-11-13T17:00:00Z");

describe("badgeLabel e bellLabel", () => {
	it("some em zero, mostra o número e 9+", () => {
		expect(badgeLabel(0)).toBe("");
		expect(badgeLabel(-1)).toBe("");
		expect(badgeLabel(3)).toBe("3");
		expect(badgeLabel(9)).toBe("9");
		expect(badgeLabel(10)).toBe("9+");
	});
	it("nome acessível diz quantos", () => {
		expect(bellLabel(0)).toBe("Avisos");
		expect(bellLabel(1)).toBe("Avisos, 1 não lido");
		expect(bellLabel(3)).toBe("Avisos, 3 não lidos");
		expect(bellLabel(10)).toBe("Avisos, mais de 9 não lidos");
	});
});

describe("groupByDay (São Paulo)", () => {
	it("Hoje, Ontem e Antes; vazios somem", () => {
		const g = groupByDay(
			[item("a", "2026-11-13T16:00:00Z"), item("b", "2026-11-13T03:30:00Z"), item("c", "2026-11-12T15:00:00Z"), item("d", "2026-11-10T15:00:00Z")],
			NOW,
		);
		expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
			["Hoje", ["a", "b"]],
			["Ontem", ["c"]],
			["Antes", ["d"]],
		]);
		expect(groupByDay([], NOW)).toEqual([]);
	});
	it("a virada do dia é a de São Paulo, não a de UTC", () => {
		// 02:30 UTC de 13/11 ainda é 23:30 de 12/11 em São Paulo: ontem
		expect(groupByDay([item("x", "2026-11-13T02:30:00Z")], NOW)[0].label).toBe("Ontem");
		// 03:30 UTC de 13/11 já é 00:30 de 13/11 em São Paulo: hoje
		expect(groupByDay([item("y", "2026-11-13T03:30:00Z")], NOW)[0].label).toBe("Hoje");
	});
});

describe("relativeTime", () => {
	it("textos simples", () => {
		expect(relativeTime("2026-11-13T16:59:40Z", NOW)).toBe("agora");
		expect(relativeTime("2026-11-13T16:55:00Z", NOW)).toBe("há 5 min");
		expect(relativeTime("2026-11-13T15:00:00Z", NOW)).toBe("há 2 h");
		expect(relativeTime("2026-11-12T17:30:00Z", NOW)).toBe("ontem, 14:30");
		expect(relativeTime("2026-11-08T12:15:00Z", NOW)).toBe("08/11, 09:15");
	});
});
