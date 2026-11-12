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
/**
 * Devolução feita: quem pagou a despesa devolveu o que a pessoa pagou a mais. Guarda o quanto (`cents`), quando, quem
 * marcou, o comprovante DA DEVOLUÇÃO (outro documento, separado do `receipt` do pagamento original, que fica intacto)
 * e, se foi num "pagar tudo", o lote. Desfazer a devolução soma `cents` de volta ao `paidCents` e apaga este registro.
 */
export type ShareRefund = {
	cents: number;
	at: Date;
	markedBy: string;
	/** Marcada pelo administrador do grupo (e não por quem pagou). */
	byAdmin?: boolean;
	receipt?: ShareReceipt;
	batch?: ShareBatch;
};
export type ExpenseShare = {
	uid: string;
	amountCents: number;
	paidCents: number;
	/** Preenchidos só quando há pagamento registrado: quando, por quem foi marcado e como. */
	paidAt?: Date;
	markedBy?: string;
	/** Marcada como paga pelo administrador do grupo (não por quem pagou a conta). Só com `method: "manual"`. */
	markedByAdmin?: boolean;
	method?: ShareMethod;
	receipt?: ShareReceipt;
	/** Presente quando a cota foi paga num lote (vários pagamentos ao mesmo destinatário, um só comprovante). */
	batch?: ShareBatch;
	/** Presente quando a devolução do que a pessoa pagou a mais já foi feita. */
	refund?: ShareRefund;
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

/**
 * Alguém além de quem pagou já registrou pagamento? Então a despesa não pode ser apagada.
 * Cota com devolução registrada ou com comprovante também conta (mesmo que o pago já tenha voltado a 0): apagar levaria
 * junto o histórico e os comprovantes.
 */
export function hasPayments(e: { paidBy: string; shares: ExpenseShare[] }): boolean {
	return normalizeShares(e.shares).some((s) => s.uid !== e.paidBy && (s.paidCents > 0 || s.refund !== undefined || s.receipt !== undefined));
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
		if (!old) return { uid, amountCents: cents, paidCents: 0 };
		// Quem saiu, já teve tudo devolvido (cota 0, nada pago) e volta: começa limpo, sem a data, o método nem o comprovante antigos.
		if (old.amountCents === 0 && old.paidCents === 0) return { uid, amountCents: cents, paidCents: 0 };
		// Se a cota muda, o registro de uma devolução antiga deixa de valer (não dá para desfazê-la sobre outro valor).
		const { refund, ...rest } = old;
		return { ...(cents === old.amountCents && refund ? old : rest), uid, amountCents: cents };
	});
	const staying = new Set(participantUids);
	for (const old of prev) {
		if (old.uid === paidBy || staying.has(old.uid)) continue;
		// Linha de quem saiu e já teve tudo devolvido (devolução ou comprovante registrados, nada mais a acertar): fica como está.
		if (old.paidCents <= 0) {
			if (old.amountCents === 0 && (old.refund || old.receipt)) next.push(old);
			continue;
		}
		// A cota vira 0: o registro de uma devolução antiga deixa de valer (o que foi pago volta a ser "a receber de volta" por inteiro).
		const { refund: _dropped, ...rest } = old;
		void _dropped;
		next.push({ ...rest, amountCents: 0 });
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
	asAdmin = false,
	refundReceipt?: ShareReceipt,
	batch?: ShareBatch,
): ShareChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy) return null;
	const s = shares[i];
	if (s.paidCents === s.amountCents) return { shares, changed: false }; // idempotente: preserva paidAt
	if (s.paidCents > s.amountCents) {
		// Devolução: a pessoa pagou a mais. O pagamento original (paidAt, method, receipt) fica; só entra o registro da devolução.
		const refund: ShareRefund = { cents: s.paidCents - s.amountCents, at: now, markedBy: actorUid };
		if (asAdmin) refund.byAdmin = true;
		if (refundReceipt) refund.receipt = { ...refundReceipt };
		if (batch) refund.batch = { ...batch };
		return { shares: shares.map((x, j) => (j === i ? { ...s, paidCents: s.amountCents, refund } : x)), changed: true };
	}
	const settled: ExpenseShare = { ...s, paidCents: s.amountCents, paidAt: now, markedBy: actorUid, method: "manual" };
	if (asAdmin) settled.markedByAdmin = true;
	else delete settled.markedByAdmin;
	return { shares: shares.map((x, j) => (j === i ? settled : x)), changed: true };
}

/** Desfaz a quitação: volta a nada pago; cota 0 (não participa) some. */
export function undoShare(shares: ExpenseShare[], paidBy: string, targetUid: string): ShareChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy) return null;
	const s = shares[i];
	if (s.refund) {
		// Desfaz a devolução: a pessoa volta a ter o que pagou a mais para receber (o pagamento original não muda).
		const { refund, ...rest } = s;
		return { shares: shares.map((x, j) => (j === i ? { ...rest, paidCents: s.paidCents + refund.cents } : x)), changed: true };
	}
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
		delete paid.markedByAdmin;
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
		delete paid.markedByAdmin;
		return paid;
	});
	for (const uid of targets) if (!outcomes.some((o) => o.uid === uid)) outcomes.push({ uid, result: "not_found" });
	return { shares: changed ? next : shares, changed, outcomes };
}

export type RefundOutcome = { uid: string; result: "refunded"; amountCents: number } | { uid: string; result: "already_refunded" | "not_found" };

/**
 * Devolve de uma vez a várias pessoas (todas desta despesa), com o mesmo comprovante e o mesmo lote.
 * Cota sem devolução a fazer: `already_refunded` se não deve nada, `not_found` se não existe ou é a de quem pagou.
 */
export function refundShares(
	shares: ExpenseShare[],
	paidBy: string,
	targetUids: string[],
	now: Date,
	actorUid: string,
	receipt: ShareReceipt | undefined,
	batch: ShareBatch,
): { shares: ExpenseShare[]; changed: boolean; outcomes: RefundOutcome[] } {
	const targets = new Set(targetUids);
	const outcomes: RefundOutcome[] = [];
	let changed = false;
	const next = shares.map((s) => {
		if (!targets.has(s.uid)) return s;
		if (s.uid === paidBy) {
			outcomes.push({ uid: s.uid, result: "not_found" });
			return s;
		}
		if (s.paidCents <= s.amountCents) {
			outcomes.push({ uid: s.uid, result: "already_refunded" });
			return s;
		}
		outcomes.push({ uid: s.uid, result: "refunded", amountCents: s.paidCents - s.amountCents });
		changed = true;
		return settleShare([s], paidBy, s.uid, now, actorUid, false, receipt, batch)!.shares[0];
	});
	for (const uid of targets) if (!outcomes.some((o) => o.uid === uid)) outcomes.push({ uid, result: "not_found" });
	return { shares: changed ? next : shares, changed, outcomes };
}

/** Chaves de comprovante que existiam em `before` e não existem mais em `after` (para apagar do armazenamento). */
export const receiptKeysOfShare = (s: ExpenseShare): string[] => [...(s.receipt ? [s.receipt.key] : []), ...(s.refund?.receipt ? [s.refund.receipt.key] : [])];

export function droppedReceiptKeys(before: ExpenseShare[], after: ExpenseShare[]): string[] {
	const keep = new Set(after.flatMap(receiptKeysOfShare));
	return before.flatMap(receiptKeysOfShare).filter((k) => !keep.has(k));
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
