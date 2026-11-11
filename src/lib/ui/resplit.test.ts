import { describe, expect, it } from "vitest";
import { dueAndRefund, previewResplit, sameParticipants, type ResplitInput, type ResplitShare } from "./resplit";

const members = [
	{ uid: "o", name: "Rafael" },
	{ uid: "ana", name: "Ana" },
	{ uid: "jose", name: "José" },
	{ uid: "carlos", name: "Carlos" },
	{ uid: "bia", name: "Bia" },
];
const sh = (uid: string, amountCents: number, paidCents: number, participates = true): ResplitShare => ({
	uid,
	name: members.find((m) => m.uid === uid)!.name,
	amountCents,
	paidCents,
	participates,
});

// R$ 100,00 entre Rafael (dono), Ana, Carlos e Bia (25 cada)
const four: ResplitShare[] = [sh("o", 2500, 2500), sh("ana", 2500, 2500), sh("carlos", 2500, 2500), sh("bia", 2500, 0)];
const run = (over: Partial<ResplitInput>) =>
	previewResplit({ amountCents: 10000, payerUid: "o", shares: four, members, newParticipantUids: ["o", "ana", "carlos", "bia"], ...over });

function ok(r: ReturnType<typeof previewResplit>) {
	if (r.kind !== "ok") throw new Error(`esperava ok, veio ${r.kind}`);
	return r;
}

describe("dueAndRefund", () => {
	it("deve a diferença ou recebe de volta", () => {
		expect(dueAndRefund(2000, 500)).toEqual({ dueCents: 1500, refundCents: 0 });
		expect(dueAndRefund(2000, 2500)).toEqual({ dueCents: 0, refundCents: 500 });
		expect(dueAndRefund(2000, 2000)).toEqual({ dueCents: 0, refundCents: 0 });
	});
});

describe("previewResplit", () => {
	it("sem participantes: vazio", () => expect(run({ newParticipantUids: [] })).toEqual({ kind: "empty" }));

	it("valor pequeno demais: erro", () => {
		expect(run({ amountCents: 2, newParticipantUids: ["o", "ana", "bia"] }).kind).toBe("error");
	});

	it("mesma divisão: nada mudou", () => {
		const r = ok(run({}));
		expect(r.changed).toBe(false);
		expect(r.lines).toEqual([]);
		expect(r.refundTotalCents).toBe(0);
		expect(r.base).toBe(2500);
	});

	it("entra mais gente: quem já pagou recebe a diferença de volta e o novo passa a dever", () => {
		const r = ok(run({ newParticipantUids: ["o", "ana", "carlos", "bia", "jose"] }));
		expect(r.base).toBe(2000);
		// Ana e Carlos pagaram 25, agora a parte é 20 -> 5 de volta; Bia nada pago -> deve 20; José novo -> deve 20
		expect(r.lines.map((l) => l.text)).toEqual([
			"Ana: parte de R$ 25,00 → R$ 20,00 · recebe de volta R$ 5,00",
			"Carlos: parte de R$ 25,00 → R$ 20,00 · recebe de volta R$ 5,00",
			"Bia: parte de R$ 25,00 → R$ 20,00",
			"José: passa a dever R$ 20,00",
		]);
		expect(r.refundTotalCents).toBe(1000);
		expect(r.dueTotalCents).toBe(4000);
		expect(r.changed).toBe(true);
	});

	it("sai gente depois de pagar: continua listada com o pagamento a devolver", () => {
		const r = ok(run({ newParticipantUids: ["o", "ana", "bia"] }));
		expect(r.base).toBe(3333);
		expect(r.lines.map((l) => l.text)).toEqual([
			"Ana: parte de R$ 25,00 → R$ 33,33 · falta pagar R$ 8,33",
			"Carlos: sai da divisão · recebe de volta R$ 25,00",
			"Bia: parte de R$ 25,00 → R$ 33,33",
		]);
		expect(r.newShares.find((s) => s.uid === "carlos")).toEqual({ uid: "carlos", amountCents: 0, dueCents: 0, refundCents: 2500 });
		expect(r.refundTotalCents).toBe(2500);
	});

	it("sai gente que não tinha pago nada: só sai", () => {
		const r = ok(run({ newParticipantUids: ["o", "ana", "carlos"] }));
		expect(r.lines.map((l) => l.text)).toContain("Bia: sai da divisão");
		expect(r.refundTotalCents).toBe(0);
	});

	it("o dono nunca deve nem recebe de volta, mesmo com a parte dele mudando", () => {
		const r = ok(run({ newParticipantUids: ["o", "ana"] }));
		expect(r.newShares.find((s) => s.uid === "o")).toEqual({ uid: "o", amountCents: 5000, dueCents: 0, refundCents: 0 });
		expect(r.lines.some((l) => l.uid === "o")).toBe(false);
	});

	it("a sobra de centavos fica com o dono e a soma fecha o total", () => {
		const r = ok(run({ amountCents: 10000, newParticipantUids: ["o", "ana", "carlos"] }));
		expect(r.newShares.filter((s) => ["o", "ana", "carlos"].includes(s.uid)).reduce((a, s) => a + s.amountCents, 0)).toBe(10000);
		expect(r.newShares.find((s) => s.uid === "o")!.amountCents).toBe(3334);
	});

	it("dono fora da divisão: centavos vão para os primeiros e o dono não aparece com dívida", () => {
		const r = ok(run({ newParticipantUids: ["ana", "carlos", "bia"] }));
		expect(r.newShares.find((s) => s.uid === "o")).toEqual({ uid: "o", amountCents: 0, dueCents: 0, refundCents: 0 });
		expect(r.newShares.find((s) => s.uid === "ana")!.amountCents).toBe(3334);
	});

	it("pagamento parcial: quem pagou metade e a parte cai", () => {
		const shares = [sh("o", 3000, 3000), sh("ana", 3000, 1000), sh("jose", 3000, 0), sh("bia", 1000, 1000)];
		// 100,00 -> 4 pessoas: 25 cada... aqui o total é 90,00 + 10,00 do exemplo; usamos 100,00
		const r = ok(run({ shares, newParticipantUids: ["o", "ana", "jose", "bia"] }));
		expect(r.base).toBe(2500);
		expect(r.lines.map((l) => l.text)).toEqual([
			"Ana: parte de R$ 30,00 → R$ 25,00 · falta pagar R$ 15,00",
			"José: parte de R$ 30,00 → R$ 25,00",
			"Bia: parte de R$ 10,00 → R$ 25,00 · falta pagar R$ 15,00",
		]);
	});

	it("quem já tinha saído e continua fora não aparece de novo", () => {
		const shares = [...four.slice(0, 3), sh("bia", 0, 2500, false)];
		const r = ok(run({ shares, newParticipantUids: ["o", "ana", "carlos"] }));
		expect(r.lines.some((l) => l.uid === "bia")).toBe(false);
		expect(r.newShares.find((s) => s.uid === "bia")!.refundCents).toBe(2500);
		expect(r.refundTotalCents).toBe(2500 + (r.newShares.find((s) => s.uid === "ana")!.refundCents));
	});

	it("quem saiu depois de pagar e volta para a divisão", () => {
		const shares = [sh("o", 5000, 5000), sh("ana", 5000, 5000), sh("bia", 0, 2000, false)];
		const r = ok(run({ shares, newParticipantUids: ["o", "ana", "bia"] }));
		expect(r.lines.find((l) => l.uid === "bia")!.text).toBe("Bia: volta para a divisão · parte de R$ 33,33 · falta pagar R$ 13,33");
	});

	it("divisão só com o dono", () => {
		const r = ok(run({ shares: [sh("o", 10000, 10000)], newParticipantUids: ["o"] }));
		expect(r.changed).toBe(false);
		expect(r.base).toBe(10000);
	});

	it("dono sozinho e depois chega gente", () => {
		const r = ok(run({ shares: [sh("o", 10000, 10000)], newParticipantUids: ["o", "ana"] }));
		expect(r.lines.map((l) => l.text)).toEqual(["Ana: passa a dever R$ 50,00"]);
		expect(r.dueTotalCents).toBe(5000);
	});

	it("usa o nome do grupo para quem não está na despesa", () => {
		const r = ok(run({ shares: [sh("o", 10000, 10000)], newParticipantUids: ["o", "jose"] }));
		expect(r.lines[0].name).toBe("José");
	});
});

describe("sameParticipants", () => {
	it("ignora a ordem", () => {
		expect(sameParticipants(["a", "b"], ["b", "a"])).toBe(true);
		expect(sameParticipants(["a", "b"], ["a", "c"])).toBe(false);
		expect(sameParticipants(["a"], ["a", "b"])).toBe(false);
	});
});
