import { ObjectId, type Db } from "mongodb";
import { directory, expensesCollection, findMemberGroup, loadPeople } from "@/lib/expenses/repo";
import { materializeSafely } from "@/lib/recurrences/materialize";
import { fairnessPercent, reportPipeline, type Facet } from "./compute";
import { dateFilter, periodKey, type Period } from "./period";

export type ReportPerson = {
	uid: string;
	name: string;
	picture: string | null;
	kind: "user" | "managed";
	isYou: boolean;
	youManage: boolean;
	stillMember: boolean;
	advancedCents: number;
	shareCents: number;
	bornCents: number;
	pendingCents: number;
	owedBackCents: number;
	helpedCount: number;
	expensesPaidCount: number;
	/** Pontos-base (0..10000) de `bornCents` sobre `totalCents`. */
	bornPercent: number;
};

export type Report = {
	period: string;
	groupName: string;
	expenseCount: number;
	totalCents: number;
	equalShareCents: number;
	fairnessPercent: number;
	people: ReportPerson[];
	months: { month: string; totalCents: number }[];
};

export type ReportResult = { status: "ok"; report: Report } | { status: "no_group" };

/**
 * Relatório de contribuições do grupo no período. Uma só agregação sobre as despesas (agrupada por pessoa)
 * mais a lista de membros. Nunca expõe e-mail nem chave Pix (projeção explícita em `loadPeople`).
 */
export async function getGroupReport(db: Db, groupId: string, uid: string, period: Period): Promise<ReportResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	await materializeSafely(db, [group._id]);
	const [facet] = await expensesCollection(db)
		.aggregate<Facet>(reportPipeline({ groupId: new ObjectId(groupId), ...dateFilter(period) }))
		.toArray();
	return { status: "ok", report: buildReport(group, uid, period, facet ?? { people: [], months: [], totals: [] }, await namesFor(db, group, facet)) };
}

type Group = NonNullable<Awaited<ReturnType<typeof findMemberGroup>>>;

async function namesFor(db: Db, group: Group, facet: Facet | undefined) {
	const uids = new Set([...group.members.map((m) => m.uid), ...(facet?.people ?? []).map((p) => p._id)]);
	return loadPeople(db, [...uids]);
}

/** Monta a resposta a partir das somas por pessoa (as do MongoDB ou as da referência em JS). */
export function buildReport(
	group: Group,
	caller: string,
	period: Period,
	facet: Facet,
	people: Awaited<ReturnType<typeof loadPeople>>,
): Report {
	const dir = directory(group, people, caller);
	const totalCents = facet.totals[0]?.total ?? 0;
	const rows = new Map(facet.people.map((r) => [r._id, r]));
	const current = new Set(group.members.map((m) => m.uid));
	const uids = [...new Set([...current, ...rows.keys()])];
	const equalShareCents = uids.length > 0 ? Math.floor(totalCents / uids.length) : 0;

	const list: ReportPerson[] = uids.map((u) => {
		const r = rows.get(u);
		return {
			uid: u,
			name: dir.name(u),
			picture: dir.picture(u),
			kind: dir.kind(u),
			isYou: u === caller,
			youManage: dir.youManage(u),
			stillMember: current.has(u),
			advancedCents: r?.advanced ?? 0,
			shareCents: r?.share ?? 0,
			bornCents: r?.born ?? 0,
			pendingCents: r?.pending ?? 0,
			owedBackCents: r?.owedBack ?? 0,
			helpedCount: r?.helped ?? 0,
			expensesPaidCount: r?.paidCount ?? 0,
			bornPercent: totalCents > 0 ? Math.round(((r?.born ?? 0) * 10000) / totalCents) : 0,
		};
	});
	list.sort((a, b) => b.bornCents - a.bornCents || a.name.localeCompare(b.name, "pt-BR") || a.uid.localeCompare(b.uid));

	return {
		period: periodKey(period),
		groupName: group.name,
		expenseCount: facet.totals[0]?.count ?? 0,
		totalCents,
		equalShareCents,
		fairnessPercent: fairnessPercent(
			list.filter((p) => p.stillMember).map((p) => p.bornCents),
			equalShareCents,
			totalCents,
		),
		people: list,
		months: facet.months.map((m) => ({ month: m._id, totalCents: m.total })),
	};
}
