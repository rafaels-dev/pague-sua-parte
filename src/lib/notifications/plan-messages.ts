import { formatBRL } from "@/lib/money";
import { clipText as clip, fitSubject, shortName } from "./subjects";
import type { Notice, NoticeContext, PlanCancelFact, PlanChangeFact, PlanClosedFact, PlanConfirmedFact, PlanNoticeBase } from "./types";

const planUrl = (f: PlanNoticeBase) => `/app/planos/${f.planId}`;
const planScope = (f: PlanNoticeBase) => ({ kind: "plan" as const, name: f.name });

/** Quem recebe os avisos de uma pessoa do plano: ela mesma, ou quem a acrescentou (pessoa sem celular). Fora do plano: ninguém. */
export function planLoginOf(f: PlanNoticeBase, id: string): string | null {
	if (f.participants.includes(id)) return id;
	const g = f.guests.find((x) => x.id === id);
	return g && f.participants.includes(g.addedBy) ? g.addedBy : null;
}

const nameOf = (f: PlanNoticeBase, id: string) => f.guests.find((g) => g.id === id)?.name ?? "Você";

function dedupe(notices: Notice[]): Notice[] {
	const seen = new Set<string>();
	return notices.filter((n) => {
		const k = JSON.stringify([n.uid, n.title, n.body, n.url]);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

/**
 * Depois de uma resposta ou edição: só TRANSIÇÕES entre a conta de antes e a de depois.
 * (a) passou de "não fecha" para "fecha": o criador e quem entrou na conta.
 * Nunca avisa quem fez a ação; sem aviso quando nada mudou para o destinatário.
 */
export function buildPlanChangeNotices(f: PlanChangeFact): Notice[] {
	const out: Notice[] = [];
	const url = planUrl(f);
	const title = clip(f.name);
	if (!f.before.fits && f.after.fits && f.after.shareCents !== null) {
		const to = new Set<string>();
		const creator = planLoginOf(f, f.creatorUid);
		if (creator) to.add(creator);
		for (const id of f.after.includedUids) {
			const l = planLoginOf(f, id);
			if (l) to.add(l);
		}
		for (const uid of to) {
			if (uid === f.actorUid) continue;
			out.push({ uid, title: "O plano fecha", subject: fitSubject((n) => `O plano "${n}" fecha com ${formatBRL(f.after.shareCents as number)} para cada um`, f.name), body: `O plano "${title}" agora fecha: ${formatBRL(f.after.shareCents)} para cada um.`, url, scope: planScope(f), amountCents: f.after.shareCents, amountLabel: "Cada um paga" });
		}
	}
	return dedupe(out);
}

/** Plano cancelado: quem tinha dito "Vou". */
export function buildPlanCancelledNotices(f: PlanCancelFact): Notice[] {
	const out: Notice[] = [];
	for (const id of f.goingIds) {
		const uid = planLoginOf(f, id);
		if (!uid || uid === f.actorUid) continue;
		out.push({ uid, title: "Plano cancelado", subject: fitSubject((n) => `Plano cancelado: "${n}"`, f.name), body: `O plano "${clip(f.name)}" foi cancelado.`, url: planUrl(f), scope: planScope(f) });
	}
	return dedupe(out);
}

/** Plano fechado: quem disse "Vou" e ficou de fora de grupo e despesa. (Quem entrou recebe o aviso normal de despesa nova.) */
export function buildPlanClosedNotices(f: PlanClosedFact): Notice[] {
	const out: Notice[] = [];
	for (const id of f.leftOutIds) {
		const uid = planLoginOf(f, id);
		if (!uid || uid === f.actorUid) continue;
		const who = uid === id ? "você" : nameOf(f, id);
		out.push({ uid, title: "Plano fechado", subject: fitSubject((n, p) => `Plano fechado sem ${who === "você" ? who : shortName(who, p)}: "${n}"`, f.name), body: `O plano "${clip(f.name)}" foi fechado sem ${who}.`, url: planUrl(f), scope: planScope(f) });
	}
	return dedupe(out);
}

/**
 * Plano confirmado (grupo criado): o mesmo texto, sem valor, para toda pessoa com login que entrou no grupo (incluídas na divisão,
 * quem responde por pessoa sem celular e quem pagou). Nunca quem fechou o plano. A despesa nova sai à parte, como sempre.
 */
export function buildPlanConfirmedNotices(f: PlanConfirmedFact, ctx: NoticeContext): Notice[] {
	const g = ctx.group(f.groupId);
	if (!g) return [];
	const body = `O plano "${clip(f.planName)}" está confirmado e o grupo "${clip(f.groupName, 40)}" foi criado. Você já está no grupo.`;
	return dedupe(
		g.members
			.filter((m) => m.kind !== "managed" && m.uid !== f.actorUid)
			.map((m) => ({ uid: m.uid, title: "Plano confirmado", subject: fitSubject((n) => `Plano confirmado: "${n}"`, f.planName), body, url: `/app/grupos/${f.groupId}`, scope: { kind: "group" as const, name: clip(f.groupName, 40) } })),
	);
}
