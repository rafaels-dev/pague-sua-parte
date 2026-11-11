import { isDueNow, isPastDue, todayInSaoPaulo } from "./dates";
import type { AttachmentMeta } from "@/lib/storage/attachments";
import { splitEqually } from "./split";

/**
 * Modelo de cotas: cada cota guarda quanto a pessoa DEVE (`amountCents`) e quanto já PAGOU (`paidCents`).
 * Situação, valor em aberto e reembolso são sempre derivados daqui, nunca gravados.
 */
export type ShareStatus = "payer" | "pending" | "paid" | "refund";
/** "manual": o dono marcou como pago; "self": a própria pessoa avisou que pagou. */
export type ShareMethod = "manual" | "self";
/** Comprovante de pagamento da cota (mesmo formato de um anexo). `key` nunca sai da API. */
export type ShareReceipt = AttachmentMeta;
/** "Pagar tudo de uma vez": o pagamento fez parte de um lote com um só comprovante. */
export type ShareBatch = { id: string; totalCents: number; count: number };
export type ExpenseShare = {
	uid: string;
	amountCents: number;
	paidCents: number;
	/** Preenchidos só quando há pagamento registrado: quando, por quem foi marcado e como. */
	paidAt?: Date;
	markedBy?: string;
	method?: ShareMethod;
	receipt?: ShareReceipt;
	/** Presente quando a cota foi paga num lote (vários pagamentos ao mesmo destinatário, um só comprovante). */
	batch?: ShareBatch;
	/** "Quero ajudar": a pessoa entrou na divisão por conta própria (pela ação de ajudar), não por escolha do dono. */
	helped?: boolean;
	helpedAt?: Date;
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

/** Quem ajudou e ainda divide a despesa (a marca some da contagem quando a cota fica só para reembolso). */
export const isHelper = (s: ExpenseShare) => s.helped === true && s.amountCents > 0;

/**
 * Entrada de `helper` na divisão ("Quero ajudar"): divide igualmente entre quem já divide + `helper`
 * (regras de `recalcShares`) e marca a cota nova. Lança o erro de `splitEqually` se o valor for pequeno demais.
 */
export function addHelper(
	prev: ExpenseShare[],
	paidBy: string,
	amountCents: number,
	helper: string,
	now: Date,
): ExpenseShare[] {
	const next = recalcShares(prev, paidBy, amountCents, [...participantUidsOf(prev), helper]);
	return next.map((s) => (s.uid === helper ? { ...s, helped: true, helpedAt: now } : s));
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
	if (s.paidCents === 0 && s.paidAt === undefined && s.markedBy === undefined && s.method === undefined && s.receipt === undefined) {
		return { shares, changed: false };
	}
	if (s.amountCents === 0) return { shares: shares.filter((_, j) => j !== i), changed: true };
	const rest: ExpenseShare = {
		uid: s.uid,
		amountCents: s.amountCents,
		paidCents: s.paidCents,
		...(s.helped ? { helped: true, ...(s.helpedAt ? { helpedAt: s.helpedAt } : {}) } : {}),
	};
	return { shares: shares.map((x, j) => (j === i ? { ...rest, paidCents: 0 } : x)), changed: true };
}

/** Quem deve avisa que pagou (com comprovante opcional). null: alvo é quem pagou, não tem cota ou ela é só reembolso. */
export type SelfPayChange = ShareChange;
export function payShare(
	shares: ExpenseShare[],
	paidBy: string,
	targetUid: string,
	now: Date,
	actorUid: string,
	receipt?: ShareReceipt,
): SelfPayChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy || shares[i].amountCents <= 0) return null;
	const s = shares[i];
	const put = (next: ExpenseShare): ShareChange => ({ shares: shares.map((x, j) => (j === i ? next : x)), changed: true });
	if (s.paidCents < s.amountCents) {
		const paid: ExpenseShare = { ...s, paidCents: s.amountCents, paidAt: now, markedBy: actorUid, method: "self" };
		if (receipt) paid.receipt = receipt;
		else delete paid.receipt;
		delete paid.batch;
		return put(paid);
	}
	// Já quitada: só troca o comprovante (mantém paidAt, markedBy e method). Sem arquivo não muda nada.
	// O comprovante novo vale só para esta cota: ela sai do lote (as outras do lote mantêm o comprovante do lote).
	if (s.paidCents === s.amountCents && receipt) {
		const moved: ExpenseShare = { ...s, receipt };
		delete moved.batch;
		return put(moved);
	}
	return { shares, changed: false };
}

export type BatchOutcome =
	| { uid: string; result: "paid"; amountCents: number }
	| { uid: string; result: "already_paid" | "not_found" };

/**
 * Quita várias cotas de uma mesma despesa de uma vez (`method: "self"`), todas com o mesmo comprovante e o mesmo lote.
 * Cota que não existe (ou é a de quem pagou / só reembolso) vira `not_found`; a que já está quitada, `already_paid`;
 * as demais seguem normalmente. `amountCents` = o que faltava pagar na cota.
 */
export function payShares(
	shares: ExpenseShare[],
	paidBy: string,
	targetUids: string[],
	now: Date,
	actorUid: string,
	receipt: ShareReceipt | undefined,
	batch: ShareBatch,
): { shares: ExpenseShare[]; changed: boolean; outcomes: BatchOutcome[] } {
	const targets = new Set(targetUids);
	const outcomes: BatchOutcome[] = [];
	let changed = false;
	const next = shares.map((s) => {
		if (!targets.has(s.uid)) return s;
		if (s.uid === paidBy || s.amountCents <= 0) {
			outcomes.push({ uid: s.uid, result: "not_found" });
			return s;
		}
		if (s.paidCents >= s.amountCents) {
			outcomes.push({ uid: s.uid, result: "already_paid" });
			return s;
		}
		outcomes.push({ uid: s.uid, result: "paid", amountCents: s.amountCents - s.paidCents });
		changed = true;
		const paid: ExpenseShare = { ...s, paidCents: s.amountCents, paidAt: now, markedBy: actorUid, method: "self", batch: { ...batch } };
		if (receipt) paid.receipt = { ...receipt };
		else delete paid.receipt;
		return paid;
	});
	for (const uid of targets) if (!outcomes.some((o) => o.uid === uid)) outcomes.push({ uid, result: "not_found" });
	return { shares: changed ? next : shares, changed, outcomes };
}

/** Chaves de comprovante que existiam em `before` e não existem mais em `after` (para apagar do armazenamento). */
export function droppedReceiptKeys(before: ExpenseShare[], after: ExpenseShare[]): string[] {
	const keep = new Set(after.flatMap((s) => (s.receipt ? [s.receipt.key] : [])));
	return before.flatMap((s) => (s.receipt && !keep.has(s.receipt.key) ? [s.receipt.key] : []));
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
