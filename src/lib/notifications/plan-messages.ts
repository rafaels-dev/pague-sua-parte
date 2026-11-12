import { formatBRL } from "@/lib/money";
import { MAX_PLAN_PEOPLE } from "@/lib/plans/collection";
import { minPeopleForLimit } from "@/lib/plans/compute";
import type { Notice, PlanCancelFact, PlanChangeFact, PlanClosedFact, PlanNoticeBase } from "./types";

const clip = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const planUrl = (f: PlanNoticeBase) => `/app/planos/${f.planId}`;

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
 * (b) passou a ficar acima do limite: a própria pessoa (ou quem a acrescentou), com o limite dela e só dela.
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
			out.push({ uid, title: "O plano fecha", body: `O plano "${title}" agora fecha: ${formatBRL(f.after.shareCents)} para cada um.`, url });
		}
	}
	for (const id of f.after.aboveLimitUids) {
		if (f.before.aboveLimitUids.includes(id)) continue;
		const uid = planLoginOf(f, id);
		const limit = f.limits[id];
		if (!uid || uid === f.actorUid || !limit) continue;
		const own = uid === id;
		const who = own ? "o seu limite você entra" : `o limite de ${nameOf(f, id)}, ${nameOf(f, id)} entra`;
		const k = minPeopleForLimit(f.totalCents, limit, MAX_PLAN_PEOPLE);
		const body =
			k === null
				? `No plano "${title}", ${own ? "o seu limite fica" : `o limite de ${nameOf(f, id)} fica`} abaixo da parte mesmo com o plano cheio. Você pode mudar ${own ? "seu" : "o"} limite.`
				: `No plano "${title}", com ${who} quando pelo menos ${k} pessoas confirmarem. Você pode esperar ou mudar ${own ? "seu" : "o"} limite.`;
		out.push({ uid, title: own ? "Acima do seu limite por enquanto" : "Acima do limite por enquanto", body, url });
	}
	return dedupe(out);
}

/** Plano cancelado: quem tinha dito "Vou". */
export function buildPlanCancelledNotices(f: PlanCancelFact): Notice[] {
	const out: Notice[] = [];
	for (const id of f.goingIds) {
		const uid = planLoginOf(f, id);
		if (!uid || uid === f.actorUid) continue;
		out.push({ uid, title: "Plano cancelado", body: `O plano "${clip(f.name)}" foi cancelado.`, url: planUrl(f) });
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
		out.push({ uid, title: "Plano fechado", body: `O plano "${clip(f.name)}" foi fechado sem ${who}.`, url: planUrl(f) });
	}
	return dedupe(out);
}
