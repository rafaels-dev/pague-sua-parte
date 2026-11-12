import { describe, expect, it } from "vitest";
import { groupDebts } from "./group-debts";

const sh = (uid: string, amountCents: number, paidCents = 0) => ({ uid, amountCents, paidCents });
const TODAY = "2026-11-15";

describe("groupDebts", () => {
	it("cada cota pendente é dívida com quem pagou; quem pagou e quem está quite não entram", () => {
		const d = groupDebts([{ paidBy: "b", shares: [sh("b", 1000), sh("a", 1000), sh("c", 1000, 1000)] }], TODAY);
		expect(d).toEqual([{ fromUid: "a", toUid: "b", cents: 1000, overdueCents: 0, kind: "share" }]);
	});
	it("compensa dívidas de sentidos opostos entre a mesma dupla e junta despesas", () => {
		const d = groupDebts(
			[
				{ paidBy: "b", shares: [sh("b", 500), sh("a", 500)] },
				{ paidBy: "b", shares: [sh("b", 300), sh("a", 300)] },
				{ paidBy: "a", shares: [sh("a", 200), sh("b", 200)] },
			],
			TODAY,
		);
		expect(d).toEqual([{ fromUid: "a", toUid: "b", cents: 600, overdueCents: 0, kind: "share" }]);
	});
	it("marca o vencido (só a parte atrasada) e ordena com o vencido primeiro", () => {
		const d = groupDebts(
			[
				{ paidBy: "z", dueDate: "2026-11-01", shares: [sh("z", 100), sh("a", 100)] },
				{ paidBy: "z", dueDate: "2026-12-01", shares: [sh("z", 100), sh("a", 300)] },
				{ paidBy: "y", shares: [sh("y", 100), sh("c", 9000)] },
			],
			TODAY,
		);
		expect(d.map((x) => [x.fromUid, x.toUid, x.cents, x.overdueCents])).toEqual([
			["a", "z", 400, 100],
			["c", "y", 9000, 0],
		]);
	});
	it("devolução (pagou a mais) é dívida de quem pagou a despesa, separada das partes, e nunca vencida", () => {
		const d = groupDebts([{ paidBy: "b", dueDate: "2026-01-01", shares: [sh("b", 1000), sh("a", 600, 1000)] }], TODAY);
		expect(d).toEqual([{ fromUid: "b", toUid: "a", cents: 400, overdueCents: 0, kind: "refund" }]);
		const both = groupDebts(
			[
				{ paidBy: "b", shares: [sh("b", 1000), sh("a", 600, 1000)] },
				{ paidBy: "a", shares: [sh("a", 500), sh("b", 500)] },
			],
			TODAY,
		);
		expect(both.map((x) => [x.fromUid, x.toUid, x.cents, x.kind]).sort()).toEqual([["b", "a", 400, "refund"], ["b", "a", 500, "share"]].sort());
	});
	it("lê o modelo antigo (status) e devolução já feita não aparece", () => {
		const legacy = { uid: "a", amountCents: 1000, status: "paid" } as never;
		expect(groupDebts([{ paidBy: "b", shares: [sh("b", 1000), legacy] }], TODAY)).toEqual([]);
		expect(groupDebts([{ paidBy: "b", shares: [sh("b", 1000), sh("a", 0, 0)] }], TODAY)).toEqual([]);
	});
});
