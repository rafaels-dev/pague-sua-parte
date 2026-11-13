import type { PlanChangeFact, PlanNoticeBase, PlanSnapshot } from "@/lib/notifications/types";
import type { PlanDoc } from "./collection";
import { computeFor } from "./view";

export function noticeBase(doc: PlanDoc, actorUid: string): PlanNoticeBase {
	return {
		planId: doc._id.toHexString(),
		name: doc.name,
		totalCents: doc.totalCents,
		actorUid,
		creatorUid: doc.createdBy,
		participants: doc.participants.map((p) => p.uid),
		guests: doc.guests.map((g) => ({ id: g.id, name: g.name, addedBy: g.addedBy })),
	};
}

export function snapshotOf(doc: PlanDoc): PlanSnapshot {
	const c = computeFor(doc);
	return { fits: c.fits, shareCents: c.shareCents, includedUids: c.includedUids };
}

/** Antes e depois de uma gravação: os avisos olham só as transições entre os dois. */
export function changeFact(before: PlanDoc, after: PlanDoc, actorUid: string): PlanChangeFact {
	return { ...noticeBase(after, actorUid), before: snapshotOf(before), after: snapshotOf(after) };
}

export const goingIdsOf = (doc: PlanDoc): string[] => computeFor(doc).goingUids;
