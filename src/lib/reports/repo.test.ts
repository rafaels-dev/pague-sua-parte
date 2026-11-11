import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { inPeriod, parsePeriod } from "./period";
import { referenceFacet } from "./compute";
import { FIXTURE } from "./compute.test";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
const { getGroupReport } = await import("./repo");

const GID = "507f1f77bcf86cd799439011";
const member = (uid: string, role: "admin" | "member" = "member") => ({ uid, role, joinedAt: new Date() });
const members = [
	member("u1", "admin"),
	member("u2"),
	member("u3"),
	{ ...member("m_vo"), kind: "managed" as const, name: "Vó", managedBy: "u1", pixKey: { type: "cpf", key: "52998224725" } },
];

function mockDb(o: { expenses?: typeof FIXTURE; noGroup?: boolean } = {}) {
	const group = { _id: new ObjectId(GID), name: "Família", members };
	const groups = { findOne: vi.fn(async (f: Record<string, unknown>) => (!o.noGroup && members.some((m) => m.uid === f["members.uid"]) ? group : null)) };
	const users = {
		find: vi.fn().mockReturnValue({
			toArray: vi.fn().mockResolvedValue([
				{ _id: "u1", name: "Ana", picture: "pa" },
				{ _id: "u2", name: "Beto" },
				{ _id: "u3", name: "Caio", displayName: "Caiozinho" },
			]),
		}),
	};
	const expenses = {
		aggregate: vi.fn((pipeline: { $match?: { date?: { $gte: string; $lte: string } } }[]) => {
			const range = pipeline[0].$match?.date;
			const docs = (o.expenses ?? FIXTURE).filter((e) => !range || (e.date >= range.$gte && e.date <= range.$lte));
			return { toArray: vi.fn().mockResolvedValue([referenceFacet(docs)]) };
		}),
	};
	return { db: { collection: (n: string) => ({ groups, users, expenses })[n] } as unknown as Db, expenses, users };
}
const run = async (m: ReturnType<typeof mockDb>, period: string, uid = "u1") => {
	const r = await getGroupReport(m.db, GID, uid, parsePeriod(period)!);
	if (r.status !== "ok") throw new Error(r.status);
	return r.report;
};

beforeEach(() => vi.clearAllMocks());

describe("getGroupReport", () => {
	it("período all: contas da fixture, ordenação e ex-membro", async () => {
		const m = mockDb();
		const r = await run(m, "all");
		expect(m.expenses.aggregate).toHaveBeenCalledTimes(1);
		expect(r).toMatchObject({ period: "all", groupName: "Família", expenseCount: 3, totalCents: 5200, equalShareCents: 1040, fairnessPercent: 60 });
		expect(r.people.map((p) => [p.uid, p.bornCents])).toEqual([["u1", 2350], ["u2", 2200], ["x1", 300], ["u3", 250], ["m_vo", 100]]);
		expect(r.people.reduce((t, p) => t + p.bornCents, 0)).toBe(r.totalCents);
		expect(r.people.find((p) => p.uid === "u1")).toMatchObject({
			name: "Ana", picture: "pa", kind: "user", isYou: true, youManage: false, stillMember: true,
			advancedCents: 4000, shareCents: 1250, pendingCents: 0, owedBackCents: 0, helpedCount: 0, expensesPaidCount: 2, bornPercent: 4519,
		});
		expect(r.people.find((p) => p.uid === "u3")).toMatchObject({ name: "Caiozinho", pendingCents: 1000, helpedCount: 1, bornPercent: 481 });
		expect(r.people.find((p) => p.uid === "m_vo")).toMatchObject({ name: "Vó", kind: "managed", youManage: true, picture: null, pendingCents: 150 });
		expect(r.people.find((p) => p.uid === "x1")).toMatchObject({ name: "Participante", stillMember: false, owedBackCents: 50, isYou: false });
		expect(r.months).toEqual([{ month: "2026-10", totalCents: 1000 }, { month: "2026-11", totalCents: 4200 }]);
	});
	it("month:2026-11 filtra pela data da compra (igual à referência) e ex-membro some", async () => {
		const m = mockDb();
		const r = await run(m, "month:2026-11", "u2");
		const filter = (m.expenses.aggregate.mock.calls[0][0] as { $match: object }[])[0].$match;
		expect(filter).toMatchObject({ date: { $gte: "2026-11-01", $lte: "2026-11-31" } });
		const ref = referenceFacet(FIXTURE.filter((e) => inPeriod(e.date, parsePeriod("month:2026-11")!)));
		expect(r.totalCents).toBe(ref.totals[0].total);
		expect(r.people.map((p) => p.uid).sort()).toEqual(["m_vo", "u1", "u2", "u3"]);
		expect(r.equalShareCents).toBe(1050);
		expect(r.people.find((p) => p.isYou)!.uid).toBe("u2");
		expect(r.people.reduce((t, p) => t + p.bornCents, 0)).toBe(4200);
	});
	it("sem despesas: zeros, 100% e membros listados por nome", async () => {
		const r = await run(mockDb({ expenses: [] }), "year:2030");
		expect(r).toMatchObject({ expenseCount: 0, totalCents: 0, equalShareCents: 0, fairnessPercent: 100, months: [] });
		expect(r.people.map((p) => p.name)).toEqual(["Ana", "Beto", "Caiozinho", "Vó"]);
		expect(r.people.every((p) => p.bornPercent === 0 && p.stillMember)).toBe(true);
	});
	it("não membro: no_group; nunca expõe e-mail nem chave Pix", async () => {
		expect(await getGroupReport(mockDb({ noGroup: true }).db, GID, "x", { kind: "all" })).toEqual({ status: "no_group" });
		expect(await getGroupReport(mockDb().db, "ruim", "u1", { kind: "all" })).toEqual({ status: "no_group" });
		const m = mockDb();
		const json = JSON.stringify(await run(m, "all"));
		expect(json).not.toMatch(/52998224725|email|pix/i);
		expect(m.users.find.mock.calls[0][1]).toEqual({ projection: { name: 1, displayName: 1, picture: 1 } });
	});
});
