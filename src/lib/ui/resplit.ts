import { formatBRL } from "@/lib/money";
import { splitEqually } from "@/lib/expenses/split";

export type ResplitShare = {
	uid: string;
	name: string;
	/** Parte atual (0 para quem já saiu da divisão). */
	amountCents: number;
	/** Quanto a pessoa já pagou ao dono. */
	paidCents: number;
	participates: boolean;
};

export type ResplitInput = {
	amountCents: number;
	/** Quem pagou a conta (o dono): nunca deve nem recebe de volta. */
	payerUid: string;
	/** As pessoas que já estão na despesa (inclusive quem saiu e ainda tem dinheiro a receber). */
	shares: ResplitShare[];
	/** Nomes de todo o grupo, para quem ainda não está na despesa. */
	members: { uid: string; name: string }[];
	newParticipantUids: string[];
};

export type ResplitLine = { uid: string; name: string; detail: string; text: string };

export type ResplitNewShare = { uid: string; amountCents: number; dueCents: number; refundCents: number };

export type ResplitResult =
	| { kind: "empty" }
	| { kind: "error"; message: string }
	| {
			kind: "ok";
			/** false = a divisão escolhida é igual à atual. */
			changed: boolean;
			/** Valor de cada um depois de recalcular (sem o dono em due/refund). */
			base: number;
			newShares: ResplitNewShare[];
			lines: ResplitLine[];
			/** Quanto o dono terá de devolver, somando todo mundo. */
			refundTotalCents: number;
			/** Quanto ainda falta receber, somando todo mundo. */
			dueTotalCents: number;
	  };

/** Quanto a pessoa deve / tem a receber de volta, dada a parte nova e o que ela já pagou. */
export function dueAndRefund(newShareCents: number, paidCents: number): { dueCents: number; refundCents: number } {
	return { dueCents: Math.max(0, newShareCents - paidCents), refundCents: Math.max(0, paidCents - newShareCents) };
}

/**
 * Prévia (no navegador) do que muda ao refazer a divisão: o valor TOTAL é dividido igualmente entre
 * os participantes novos (regra 2); quem pagou mais que a nova parte recebe a diferença de volta,
 * quem pagou menos deve só a diferença e quem saiu depois de pagar continua com seu pagamento a devolver (regra 3).
 */
export function previewResplit(input: ResplitInput): ResplitResult {
	const { amountCents, payerUid, shares, members, newParticipantUids } = input;
	if (newParticipantUids.length === 0) return { kind: "empty" };
	let split;
	try {
		split = splitEqually(amountCents, newParticipantUids, payerUid);
	} catch {
		return { kind: "error", message: "O valor é pequeno demais para dividir entre tantas pessoas." };
	}
	const newShareOf = new Map(split.map((s) => [s.uid, s.amountCents]));
	const oldOf = new Map(shares.map((s) => [s.uid, s]));
	const nameOf = new Map(members.map((m) => [m.uid, m.name]));
	for (const s of shares) nameOf.set(s.uid, s.name);

	const uids = [...new Set([...shares.map((s) => s.uid), ...newParticipantUids])];
	const newShares: ResplitNewShare[] = [];
	const lines: ResplitLine[] = [];
	let refundTotalCents = 0;
	let dueTotalCents = 0;
	let changed = false;

	for (const uid of uids) {
		const old = oldOf.get(uid);
		const wasIn = old ? old.participates : false;
		const nowIn = newShareOf.has(uid);
		const oldShare = wasIn && old ? old.amountCents : 0;
		const newShare = newShareOf.get(uid) ?? 0;
		const paid = old?.paidCents ?? 0;
		if (wasIn !== nowIn) changed = true;
		else if (nowIn && oldShare !== newShare) changed = true;

		if (uid === payerUid) {
			newShares.push({ uid, amountCents: newShare, dueCents: 0, refundCents: 0 });
			continue;
		}
		const { dueCents, refundCents } = dueAndRefund(newShare, paid);
		newShares.push({ uid, amountCents: newShare, dueCents, refundCents });
		refundTotalCents += refundCents;
		dueTotalCents += dueCents;

		const name = nameOf.get(uid) ?? "Alguém";
		const oldDue = old ? dueAndRefund(oldShare, paid).dueCents : 0;
		const oldRefund = old ? dueAndRefund(oldShare, paid).refundCents : 0;
		const suffix = refundCents > 0 ? ` · recebe de volta ${formatBRL(refundCents)}` : dueCents > 0 && paid > 0 ? ` · falta pagar ${formatBRL(dueCents)}` : "";

		let detail: string | null = null;
		if (wasIn && nowIn) {
			if (newShare !== oldShare || oldDue !== dueCents || oldRefund !== refundCents) {
				detail = `parte de ${formatBRL(oldShare)} → ${formatBRL(newShare)}${suffix}`;
			}
		} else if (!wasIn && nowIn) {
			if (paid > 0) detail = `volta para a divisão · parte de ${formatBRL(newShare)}${suffix}`;
			else detail = `passa a dever ${formatBRL(dueCents)}`;
		} else if (wasIn && !nowIn) {
			detail = paid > 0 ? `sai da divisão · recebe de volta ${formatBRL(paid)}` : "sai da divisão";
		}
		if (detail) lines.push({ uid, name, detail, text: `${name}: ${detail}` });
	}

	const base = Math.min(...split.map((s) => s.amountCents));
	return { kind: "ok", changed, base, newShares, lines, refundTotalCents, dueTotalCents };
}

/** Os mesmos participantes (ignorando a ordem)? */
export function sameParticipants(a: string[], b: string[]): boolean {
	return a.length === b.length && new Set([...a, ...b]).size === a.length;
}
