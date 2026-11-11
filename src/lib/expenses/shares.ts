import { isDueNow, isPastDue, todayInSaoPaulo } from "./dates";
import { splitEqually } from "./split";

/**
 * Modelo de cotas: cada cota guarda quanto a pessoa DEVE (`amountCents`) e quanto já PAGOU (`paidCents`).
 * Situação, valor em aberto e reembolso são sempre derivados daqui, nunca gravados.
 */
export type ShareStatus = "payer" | "pending" | "paid" | "refund";
export type ShareMethod = "manual";
export type ExpenseShare = {
	uid: string;
	amountCents: number;
	paidCents: number;
	/** Preenchidos só quando há pagamento registrado: quando, por quem foi marcado e como. */
	paidAt?: Date;
	markedBy?: string;
	method?: ShareMethod;
};

/**
 * Lê uma cota gravada no modelo antigo (`status`, sem `paidCents`): 'paid' vale paidCents = amountCents,
 * qualquer outro vale 0, e `status` some. Cotas já no modelo novo passam sem mudança.
 */
export function normalizeShare(s: ExpenseShare): ExpenseShare {
	const legacy = s as ExpenseShare & { status?: unknown };
	if (typeof legacy.paidCents === "number") return s;
	const { status, ...rest } = legacy;
	return { ...rest, paidCents: status === "paid" ? legacy.amountCents : 0 };
}

export const normalizeShares = (shares: ExpenseShare[]): ExpenseShare[] =>
	shares.some((s) => typeof s.paidCents !== "number") ? shares.map(normalizeShare) : shares;

/** Quanto a pessoa ainda deve a quem pagou. A cota de quem pagou nunca deve nada. */
export function dueCents(s: ExpenseShare, paidBy: string): number {
	return s.uid === paidBy ? 0 : Math.max(0, s.amountCents - s.paidCents);
}

/** Quanto quem pagou deve devolver à pessoa (ela pagou mais do que a cota atual). */
export function refundCents(s: ExpenseShare, paidBy: string): number {
	return s.uid === paidBy ? 0 : Math.max(0, s.paidCents - s.amountCents);
}

export function shareStatus(s: ExpenseShare, paidBy: string): ShareStatus {
	if (s.uid === paidBy) return "payer";
	if (s.paidCents < s.amountCents) return "pending";
	if (s.paidCents > s.amountCents) return "refund";
	return "paid"; // paidCents === amountCents (cota 0 sem pagamento não deveria existir)
}

export const participates = (s: ExpenseShare) => s.amountCents > 0;

/** Quem divide a despesa agora: cotas com valor > 0 (inclui quem pagou, se participa). */
export function participantUidsOf(shares: ExpenseShare[]): string[] {
	return shares.filter(participates).map((s) => s.uid);
}

/** Alguém além de quem pagou já registrou pagamento? Então a despesa não pode ser apagada. */
export function hasPayments(e: { paidBy: string; shares: ExpenseShare[] }): boolean {
	return normalizeShares(e.shares).some((s) => s.uid !== e.paidBy && s.paidCents > 0);
}

/**
 * Refaz a divisão do TOTAL igualmente entre `participantUids`, preservando o que cada um já pagou.
 * Quem saiu da divisão só continua na despesa (cota 0) se já tinha pagado — para ser reembolsado.
 * Lança o erro de `splitEqually` se o valor for pequeno demais.
 */
export function recalcShares(
	prev: ExpenseShare[],
	paidBy: string,
	amountCents: number,
	participantUids: string[],
): ExpenseShare[] {
	const split = splitEqually(amountCents, participantUids, paidBy);
	const before = new Map(prev.map((s) => [s.uid, s]));
	const next: ExpenseShare[] = split.map(({ uid, amountCents: cents }) => {
		if (uid === paidBy) return { uid, amountCents: cents, paidCents: 0 };
		const old = before.get(uid);
		return { ...(old ?? { paidCents: 0 }), uid, amountCents: cents };
	});
	const staying = new Set(participantUids);
	for (const old of prev) {
		if (old.uid === paidBy || staying.has(old.uid) || old.paidCents <= 0) continue;
		next.push({ ...old, amountCents: 0 });
	}
	return next;
}

export type ShareChange = { shares: ExpenseShare[]; changed: boolean };

/** Dono quita a cota (pendente recebida ou reembolso devolvido). null: alvo é o dono ou não tem cota. */
export function settleShare(
	shares: ExpenseShare[],
	paidBy: string,
	targetUid: string,
	now: Date,
	actorUid: string,
): ShareChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy) return null;
	const s = shares[i];
	if (s.paidCents === s.amountCents) return { shares, changed: false }; // idempotente: preserva paidAt
	if (s.amountCents === 0) return { shares: shares.filter((_, j) => j !== i), changed: true };
	const settled: ExpenseShare = { ...s, paidCents: s.amountCents, paidAt: now, markedBy: actorUid, method: "manual" };
	return { shares: shares.map((x, j) => (j === i ? settled : x)), changed: true };
}

/** Desfaz a quitação: volta a nada pago; cota 0 (não participa) some. */
export function undoShare(shares: ExpenseShare[], paidBy: string, targetUid: string): ShareChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy) return null;
	const s = shares[i];
	if (s.paidCents === 0 && s.paidAt === undefined && s.markedBy === undefined && s.method === undefined) {
		return { shares, changed: false };
	}
	if (s.amountCents === 0) return { shares: shares.filter((_, j) => j !== i), changed: true };
	const rest: ExpenseShare = { uid: s.uid, amountCents: s.amountCents, paidCents: s.paidCents };
	return { shares: shares.map((x, j) => (j === i ? { ...rest, paidCents: 0 } : x)), changed: true };
}

/** Ordem de exibição: dono, depois participantes por nome, depois linhas de reembolso (não participam). */
export function orderShares<T extends { uid: string; amountCents: number }>(
	shares: T[],
	paidBy: string,
	nameOf: (uid: string) => string,
): T[] {
	const rank = (s: T) => (s.uid === paidBy ? 0 : s.amountCents > 0 ? 1 : 2);
	return [...shares].sort(
		(a, b) => rank(a) - rank(b) || nameOf(a.uid).localeCompare(nameOf(b.uid), "pt-BR") || a.uid.localeCompare(b.uid),
	);
}

export type Balance = {
	/** Tudo o que está em aberto. */
	toReceiveCents: number;
	toPayCents: number;
	/** A parte de cima cuja despesa não tem vencimento ou vence até o fim do mês atual (reembolsos sempre contam). */
	toReceiveNowCents: number;
	toPayNowCents: number;
	/** O que a pessoa deve em despesas com vencimento antes de hoje. */
	overdueToPayCents: number;
};

/**
 * Referência em JS da conta de saldos (a agregação do MongoDB faz o mesmo):
 * a pagar = o que `uid` deve + reembolsos que `uid` deve como dono;
 * a receber = o que devem a `uid` como dono + reembolsos que outros donos devem a `uid`.
 * "Agora" = sem `dueDate` ou `dueDate` até o último dia do mês de hoje (São Paulo); reembolso sempre é "agora".
 */
export function balanceOf(
	expenses: { paidBy: string; shares: ExpenseShare[]; dueDate?: string | null }[],
	uid: string,
	now: Date = new Date(),
): Balance {
	const today = todayInSaoPaulo(now);
	const b: Balance = { toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 };
	for (const e of expenses) {
		const dueNow = isDueNow(e.dueDate, today);
		const late = isPastDue(e.dueDate, today);
		for (const s of normalizeShares(e.shares)) {
			if (s.uid === e.paidBy) continue;
			const due = dueCents(s, e.paidBy);
			const refund = refundCents(s, e.paidBy);
			if (e.paidBy === uid) {
				b.toReceiveCents += due;
				b.toReceiveNowCents += dueNow ? due : 0;
				b.toPayCents += refund;
				b.toPayNowCents += refund;
			} else if (s.uid === uid) {
				b.toPayCents += due;
				b.toPayNowCents += dueNow ? due : 0;
				b.overdueToPayCents += late ? due : 0;
				b.toReceiveCents += refund;
				b.toReceiveNowCents += refund;
			}
		}
	}
	return b;
}
