import { ObjectId, type Db } from "mongodb";
import { lastDayOfMonth, todayInSaoPaulo } from "@/lib/expenses/dates";
import {
	expensesCollection,
	findExpense,
	fillMissingPix,
	loadPeople,
	memberGroupsOf,
	loadPixKeys,
	mutateShares,
	releaseReceipts,
	type ExpenseDoc,
} from "@/lib/expenses/repo";
import { dueCents, normalizeShares, payShares, refundCents, refundShares, type BatchOutcome, type RefundOutcome, type ShareBatch } from "@/lib/expenses/shares";
import type { SniffedFile } from "@/lib/expenses/validation";
import { actsFor, isObjectIdHex } from "@/lib/groups/helpers";
import { groupsCollection, type GroupDoc } from "@/lib/groups/repo";
import { paymentFacts } from "@/lib/notifications/facts";
import type { PaymentFact } from "@/lib/notifications/types";
import { materializeSafely } from "@/lib/recurrences/materialize";
import { putBatchReceipt, randomId, type AttachmentMeta, type AttachmentStore } from "@/lib/storage/attachments";
import { buildPayables, recipientIdFromKey, recipientKey, type Payables } from "./payables";
import { buildReceivables, EMPTY_RECEIVABLES, type Receivables } from "./receivables";

/** Quantas contas cabem num pagamento em lote. */
export const BATCH_MAX_ITEMS = 50;

/** Despesas com alguma cota paga a mais (devolução a fazer). Só o modelo novo (`paidCents`) pode ter devolução. */
const HAS_REFUND = {
	$expr: {
		$anyElementTrue: {
			$map: {
				input: "$shares",
				as: "s",
				in: { $and: [{ $isNumber: "$$s.paidCents" }, { $ne: ["$$s.uid", "$paidBy"] }, { $gt: ["$$s.paidCents", "$$s.amountCents"] }] },
			},
		},
	},
};

// ---------- o que dá para pagar ----------

/** Roda a geração das despesas fixas dos grupos de `uid` (falha não derruba) e devolve o que ele pode pagar agora. Com `groupId`, só desse grupo (`null` se ele não é membro). */
export async function getPayables(db: Db, uid: string, now?: Date): Promise<Payables>;
export async function getPayables(db: Db, uid: string, now: Date | undefined, groupId: string): Promise<Payables | null>;
export async function getPayables(db: Db, uid: string, now: Date = new Date(), groupId?: string): Promise<Payables | null> {
	const groups = await memberGroupsOf(db, uid, groupId);
	if (!groups) return null;
	if (groups.length === 0) return { recipients: [], truncated: false };
	await materializeSafely(db, groups.map((g) => g._id), now);

	const today = todayInSaoPaulo(now);
	const acting = new Set([uid]);
	for (const g of groups) for (const m of g.members) if (m.kind === "managed" && m.managedBy === uid) acting.add(m.uid);
	const cutoff = lastDayOfMonth(today);
	const raw = await expensesCollection(db)
		.find({
			groupId: { $in: groups.map((g) => g._id) },
			"shares.uid": { $in: [...acting] },
			$or: [{ dueDate: { $exists: false } }, { dueDate: null as never }, { dueDate: { $lte: cutoff } }],
		})
		.toArray();
	const expenses = await fillMissingPix(db, groups, raw);
	// Devoluções: despesas pagas por quem `uid` age em que alguém pagou a mais.
	const refundExpenses = await expensesCollection(db)
		.find({ groupId: { $in: groups.map((g) => g._id) }, paidBy: { $in: [...acting] }, ...HAS_REFUND })
		.toArray();
	// Uma só busca de chaves Pix para todas as devoluções de todos os grupos.
	const refundUids = new Map<string, string[]>();
	for (const g of groups) {
		const gid = g._id.toHexString();
		refundUids.set(
			gid,
			refundExpenses.filter((e) => e.groupId.equals(g._id)).flatMap((e) => normalizeShares(e.shares).filter((s) => refundCents(s, e.paidBy) > 0).map((s) => s.uid)),
		);
	}
	const refundPixes = refundExpenses.length ? await loadPixKeys(db, groups, refundUids) : new Map();
	const uids = new Set<string>();
	for (const e of [...expenses, ...refundExpenses]) {
		uids.add(e.paidBy);
		for (const s of e.shares) uids.add(s.uid);
	}
	const people = await loadPeople(db, [...uids]);
	const built = buildPayables({ uid, today, groups, expenses, refundExpenses, refundPixes, people });
	return groupId === undefined ? built : { ...built, group: { id: groupId, name: groups[0].name } };
}

// ---------- o que devem a você ----------

/** Roda a geração das despesas fixas dos grupos de `uid` (falha não derruba) e devolve tudo o que ainda devem a ele. Com `groupId`, só desse grupo (`null` se ele não é membro). */
export async function getReceivables(db: Db, uid: string, now?: Date): Promise<Receivables>;
export async function getReceivables(db: Db, uid: string, now: Date | undefined, groupId: string): Promise<Receivables | null>;
export async function getReceivables(db: Db, uid: string, now: Date = new Date(), groupId?: string): Promise<Receivables | null> {
	const groups = await memberGroupsOf(db, uid, groupId);
	if (!groups) return null;
	if (groups.length === 0) return EMPTY_RECEIVABLES;
	await materializeSafely(db, groups.map((g) => g._id), now);

	const acting = new Set([uid]);
	for (const g of groups) for (const m of g.members) if (m.kind === "managed" && m.managedBy === uid) acting.add(m.uid);
	const expenses = await expensesCollection(db)
		.find({ groupId: { $in: groups.map((g) => g._id) }, paidBy: { $in: [...acting] } })
		.toArray();
	// A receber de volta: despesas (de qualquer pagador) em que `uid` ou quem ele cuida pagou a mais.
	const refundExpenses = await expensesCollection(db)
		.find({ groupId: { $in: groups.map((g) => g._id) }, "shares.uid": { $in: [...acting] }, ...HAS_REFUND })
		.toArray();
	const uids = new Set<string>();
	for (const e of [...expenses, ...refundExpenses]) {
		uids.add(e.paidBy);
		for (const s of e.shares) uids.add(s.uid);
	}
	const people = await loadPeople(db, [...uids]);
	const built = buildReceivables({ uid, today: todayInSaoPaulo(now), groups, expenses, refundExpenses, people });
	return groupId === undefined ? built : { ...built, group: { id: groupId, name: groups[0].name } };
}

// ---------- pagar tudo de uma vez ----------

/** `kind: "refund"`: `shareUid` é quem recebe de volta e `uid` age por quem pagou a despesa. Sem `kind` = pagar a parte de `shareUid`. */
export type BatchItemInput = { groupId: string; expenseId: string; shareUid: string; kind?: "share" | "refund" };
export type BatchFailReason = "conflict" | "already_paid" | "not_found";
export type BatchPaid = BatchItemInput & { amountCents: number };
export type BatchFailed = BatchItemInput & { reason: BatchFailReason };

export type BatchPayResult =
	| { status: "ok"; batchId: string; paid: BatchPaid[]; failed: BatchFailed[]; totalPaidCents: number; hasReceipt: boolean; /** O que mudou de fato (para avisar). */ payments?: PaymentFact[] }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "no_share" }
	| { status: "invalid"; error: string; field: "items" }
	/** O total mudou desde que a tela o mostrou (`expectedTotalCents`): nada foi gravado. */
	| { status: "stale" }
	/** Nenhuma conta pôde ser paga (mudaram no meio do caminho). */
	| { status: "all_failed" };

/** Identidade de uma conta do lote: inclui o tipo (parte a pagar x devolução) para nunca confundir as duas. */
export const itemId = (i: BatchItemInput) => `${i.groupId}:${i.expenseId}:${i.shareUid}:${i.kind === "refund" ? "refund" : "share"}`;

/**
 * Valida o pedido antes de mudar qualquer coisa: grupos de `uid`, despesas existentes, `uid` age por cada cota, cada cota
 * deve dinheiro e todas têm o mesmo destinatário (quem pagou + chave Pix). Devolve também o total pedido.
 * `expectedRecipientId` (o id que a tela recebeu em "contas a pagar"): se a chave Pix de quem recebe mudou desde então, o lote
 * é recusado em vez de ser registrado como pago para uma chave diferente da que a pessoa viu.
 */
export async function validateBatch(
	db: Db,
	uid: string,
	items: BatchItemInput[],
	expectedRecipientId?: string,
): Promise<{ status: "ok"; totalCents: number } | Exclude<BatchPayResult, { status: "ok" | "all_failed" | "stale" }>> {
	if (items.length === 0 || items.length > BATCH_MAX_ITEMS || new Set(items.map(itemId)).size !== items.length) {
		return { status: "invalid", error: "Escolha de 1 a 50 contas, sem repetir.", field: "items" };
	}
	if (!items.every((i) => isObjectIdHex(i.groupId) && isObjectIdHex(i.expenseId) && typeof i.shareUid === "string" && i.shareUid)) {
		return { status: "invalid", error: "Pedido inválido.", field: "items" };
	}
	const groupIds = [...new Set(items.map((i) => i.groupId))];
	const groups = await groupsCollection(db)
		.find({ _id: { $in: groupIds.map((g) => new ObjectId(g)) }, "members.uid": uid }, { projection: { _id: 1, members: 1 } })
		.toArray();
	const members = new Map(groups.map((g) => [g._id.toHexString(), g.members]));
	if (groupIds.some((g) => !members.has(g))) return { status: "no_group" };

	const docs = new Map<string, ExpenseDoc | null>();
	for (const i of items) {
		const k = `${i.groupId}:${i.expenseId}`;
		if (!docs.has(k)) docs.set(k, await findExpense(db, i.groupId, i.expenseId));
	}
	// Despesas sem cópia da chave (lançadas pelo administrador por quem não tinha): a chave atual de cada pagador, numa só busca.
	const groupDocs = groups as Pick<GroupDoc, "_id" | "members">[];
	const resolved = new Map<string, ExpenseDoc>(
		(await fillMissingPix(db, groupDocs, [...docs.values()].filter((d): d is ExpenseDoc => !!d && !d.pix))).map((d) => [d._id.toHexString(), d as ExpenseDoc]),
	);
	// Chaves Pix de quem recebe de volta: uma só busca para o pedido inteiro.
	const refundUids = new Map<string, string[]>();
	for (const i of items) if (i.kind === "refund") refundUids.set(i.groupId, [...(refundUids.get(i.groupId) ?? []), i.shareUid]);
	const pixes = refundUids.size ? await loadPixKeys(db, groups, refundUids) : new Map<string, { type: string; key: string; payeeName: string }>();
	const DIFFERENT = "Essas contas são de destinatários ou chaves Pix diferentes. Pague cada cartão separado.";
	let recipient: string | null = null;
	let totalCents = 0;
	for (const i of items) {
		const e = docs.get(`${i.groupId}:${i.expenseId}`);
		if (!e) return { status: "no_expense" };
		if (i.kind === "refund") {
			// Devolução: `uid` age por quem pagou a despesa e devolve a `shareUid`, para a chave Pix dele.
			if (!actsFor(members.get(i.groupId)!, uid, e.paidBy)) return { status: "forbidden" };
			const s = normalizeShares(e.shares).find((x) => x.uid === i.shareUid);
			if (!s || s.uid === e.paidBy || actsFor(members.get(i.groupId)!, uid, s.uid)) return { status: "no_share" };
			const back = refundCents(s, e.paidBy);
			if (back <= 0) return { status: "invalid", error: "Uma dessas contas já foi paga. Atualize e tente de novo.", field: "items" };
			const pix = pixes.get(`${i.groupId}:${s.uid}`);
			if (!pix) return { status: "invalid", error: "Uma dessas pessoas não tem chave Pix cadastrada.", field: "items" };
			const key = recipientKey({ paidBy: s.uid, pix });
			if (key === null) return { status: "invalid", error: "Uma dessas pessoas não tem chave Pix cadastrada.", field: "items" };
			if (recipient !== null && key !== recipient) return { status: "invalid", error: DIFFERENT, field: "items" };
			recipient = key;
			totalCents += back;
			continue;
		}
		if (!actsFor(members.get(i.groupId)!, uid, i.shareUid)) return { status: "forbidden" };
		const s = normalizeShares(e.shares).find((x) => x.uid === i.shareUid);
		if (!s || s.uid === e.paidBy || s.amountCents <= 0) return { status: "no_share" };
		const due = dueCents(s, e.paidBy);
		if (due <= 0) return { status: "invalid", error: "Uma dessas contas já foi paga. Atualize e tente de novo.", field: "items" };
		const withPix = e.pix ? e : resolved.get(e._id.toHexString());
		if (!withPix) return { status: "invalid", error: "Uma dessas contas ainda não tem chave Pix de quem recebe.", field: "items" };
		const key = recipientKey(withPix);
		if (key === null) return { status: "invalid", error: "Uma dessas contas ainda não tem chave Pix de quem recebe.", field: "items" };
		if (recipient !== null && key !== recipient) {
			return { status: "invalid", error: DIFFERENT, field: "items" };
		}
		recipient = key;
		totalCents += due;
	}
	if (expectedRecipientId !== undefined && (recipient === null || recipientIdFromKey(recipient) !== expectedRecipientId)) {
		return { status: "invalid", error: "A chave Pix de quem recebe mudou. Volte e confira de novo.", field: "items" };
	}
	return { status: "ok", totalCents };
}

/**
 * Quita várias cotas (`method: "self"`, como `markSelfPaid`) com UM comprovante opcional, guardado uma vez e ligado a todas.
 * Cada despesa é gravada com a concorrência otimista de sempre (uma despesa com várias cotas do lote é gravada uma vez);
 * as que falham no caminho (mudaram, já pagas) vão em `failed` e as outras seguem. `batch.totalCents/count` gravados
 * são os pedidos; se algo falhar, uma segunda gravação (melhor esforço) os corrige para o que de fato foi pago.
 * Nada pago: o objeto sobe e é apagado, e o resultado é `all_failed`. Sem órfãos: o objeto só fica se alguma cota o referencia.
 */
export async function payBatch(
	db: Db,
	store: AttachmentStore,
	args: { uid: string; items: BatchItemInput[]; file?: SniffedFile; now?: Date; recipientId?: string; /** Total que a tela mostrou; se o calculado agora for outro, `stale` (nada gravado, nenhum arquivo). Ausente = como antes. */ expectedTotalCents?: number },
): Promise<BatchPayResult> {
	const { uid, items, file } = args;
	const now = args.now ?? new Date();
	const checked = await validateBatch(db, uid, items, args.recipientId);
	if (checked.status !== "ok") return checked;
	if (args.expectedTotalCents !== undefined && args.expectedTotalCents !== checked.totalCents) return { status: "stale" };

	const batchId = randomId();
	const batch: ShareBatch = { id: batchId, totalCents: checked.totalCents, count: items.length };
	const receipt: AttachmentMeta | undefined = file
		? await putBatchReceipt(store, { batchId, bytes: file.bytes, name: file.name, contentType: file.contentType })
		: undefined;

	const result = new Map<string, BatchOutcome | RefundOutcome | BatchFailReason>();
	const paidDocs: { groupId: string; eid: string }[] = [];
	const facts: PaymentFact[] = [];
	try {
		const byExpense = new Map<string, BatchItemInput[]>();
		for (const i of items) byExpense.set(`${i.groupId}:${i.expenseId}`, [...(byExpense.get(`${i.groupId}:${i.expenseId}`) ?? []), i]);
		for (const list of byExpense.values()) {
			const { groupId, expenseId } = list[0];
			const targets = list.filter((i) => i.kind !== "refund").map((i) => i.shareUid);
			const refundTargets = list.filter((i) => i.kind === "refund").map((i) => i.shareUid);
			let shareOutcomes: BatchOutcome[] = [];
			let refundOutcomes: RefundOutcome[] = [];
			const r = await mutateShares(db, groupId, expenseId, (e) => {
				// Partes a pagar e devoluções do mesmo destinatário na mesma despesa: uma escrita só.
				const c = targets.length ? payShares(e.shares, e.paidBy, targets, now, uid, receipt, batch) : { shares: e.shares, changed: false, outcomes: [] as BatchOutcome[] };
				const d = refundTargets.length ? refundShares(c.shares, e.paidBy, refundTargets, now, uid, receipt, batch) : { shares: c.shares, changed: false, outcomes: [] as RefundOutcome[] };
				shareOutcomes = c.outcomes;
				refundOutcomes = d.outcomes;
				return { shares: d.shares, changed: c.changed || d.changed };
			});
			for (const i of list) {
				if (r.kind === "ok") result.set(itemId(i), (i.kind === "refund" ? refundOutcomes : shareOutcomes).find((o) => o.uid === i.shareUid) ?? "not_found");
				else result.set(itemId(i), r.kind === "no_expense" ? "not_found" : "conflict");
			}
			if (r.kind === "ok" && r.wrote) {
				paidDocs.push({ groupId, eid: expenseId });
				facts.push(...paymentFacts(r.doc, r.before.shares, r.doc.shares, uid, false));
			}
		}
	} catch (err) {
		await releaseReceipts(db, store, receipt ? [receipt.key] : []);
		throw err;
	}

	const paid: BatchPaid[] = [];
	const failed: BatchFailed[] = [];
	for (const i of items) {
		const o = result.get(itemId(i));
		if (o && typeof o === "object" && (o.result === "paid" || o.result === "refunded")) paid.push({ ...i, amountCents: o.amountCents });
		else {
			const reason = typeof o === "string" ? o : o?.result === "already_refunded" ? "already_paid" : (o?.result as BatchFailReason | undefined);
			failed.push({ ...i, reason: reason ?? "conflict" });
		}
	}
	const totalPaidCents = paid.reduce((t, p) => t + p.amountCents, 0);

	if (paid.length === 0) {
		await releaseReceipts(db, store, receipt ? [receipt.key] : []);
		return { status: "all_failed" };
	}
	// `batch.totalCents/count` gravados são sempre o que foi de fato pago: corrige também quando o total mudou entre a validação e a gravação.
	if (failed.length > 0 || totalPaidCents !== checked.totalCents) await correctBatchTotals(db, uid, batchId, paidDocs, { id: batchId, totalCents: totalPaidCents, count: paid.length });
	return { status: "ok", batchId, paid, failed, totalPaidCents, hasReceipt: Boolean(receipt), payments: facts };
}

/** Melhor esforço: ajusta o lote gravado ao que de fato foi pago. Se perder a corrida, fica o valor pedido. */
async function correctBatchTotals(db: Db, uid: string, batchId: string, docs: { groupId: string; eid: string }[], batch: ShareBatch) {
	for (const d of docs) {
		try {
			await mutateShares(db, d.groupId, d.eid, (e) => ({
				shares: e.shares.map((s) => {
					if (s.refund?.batch?.id === batchId) return { ...s, refund: { ...s.refund, batch: { ...batch } } };
					return s.batch?.id === batchId && s.markedBy === uid ? { ...s, batch: { ...batch } } : s;
				}),
				changed: e.shares.some((s) => s.batch?.id === batchId || s.refund?.batch?.id === batchId),
			}));
		} catch {
			console.error("payBatch totals error");
		}
	}
}
