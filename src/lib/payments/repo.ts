import { ObjectId, type Db } from "mongodb";
import { lastDayOfMonth, todayInSaoPaulo } from "@/lib/expenses/dates";
import {
	expensesCollection,
	findExpense,
	loadPeople,
	memberGroupsOf,
	mutateShares,
	releaseReceipts,
	type ExpenseDoc,
} from "@/lib/expenses/repo";
import { dueCents, normalizeShares, payShares, type BatchOutcome, type ShareBatch } from "@/lib/expenses/shares";
import type { SniffedFile } from "@/lib/expenses/validation";
import { actsFor, isObjectIdHex } from "@/lib/groups/helpers";
import { groupsCollection } from "@/lib/groups/repo";
import { materializeSafely } from "@/lib/recurrences/materialize";
import { putBatchReceipt, randomId, type AttachmentMeta, type AttachmentStore } from "@/lib/storage/attachments";
import { buildPayables, recipientKey, type Payables } from "./payables";
import { buildReceivables, EMPTY_RECEIVABLES, type Receivables } from "./receivables";

/** Quantas contas cabem num pagamento em lote. */
export const BATCH_MAX_ITEMS = 50;

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
	const expenses = await expensesCollection(db)
		.find({
			groupId: { $in: groups.map((g) => g._id) },
			"shares.uid": { $in: [...acting] },
			$or: [{ dueDate: { $exists: false } }, { dueDate: null as never }, { dueDate: { $lte: cutoff } }],
		})
		.toArray();
	const uids = new Set<string>();
	for (const e of expenses) {
		uids.add(e.paidBy);
		for (const s of e.shares) uids.add(s.uid);
	}
	const people = await loadPeople(db, [...uids]);
	const built = buildPayables({ uid, today, groups, expenses, people });
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
	const uids = new Set<string>();
	for (const e of expenses) {
		uids.add(e.paidBy);
		for (const s of e.shares) uids.add(s.uid);
	}
	const people = await loadPeople(db, [...uids]);
	const built = buildReceivables({ uid, today: todayInSaoPaulo(now), groups, expenses, people });
	return groupId === undefined ? built : { ...built, group: { id: groupId, name: groups[0].name } };
}

// ---------- pagar tudo de uma vez ----------

export type BatchItemInput = { groupId: string; expenseId: string; shareUid: string };
export type BatchFailReason = "conflict" | "already_paid" | "not_found";
export type BatchPaid = BatchItemInput & { amountCents: number };
export type BatchFailed = BatchItemInput & { reason: BatchFailReason };

export type BatchPayResult =
	| { status: "ok"; batchId: string; paid: BatchPaid[]; failed: BatchFailed[]; totalPaidCents: number; hasReceipt: boolean }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "no_share" }
	| { status: "invalid"; error: string; field: "items" }
	/** Nenhuma conta pôde ser paga (mudaram no meio do caminho). */
	| { status: "all_failed" };

const itemId = (i: BatchItemInput) => `${i.groupId}:${i.expenseId}:${i.shareUid}`;

/**
 * Valida o pedido antes de mudar qualquer coisa: grupos de `uid`, despesas existentes, `uid` age por cada cota, cada cota
 * deve dinheiro e todas têm o mesmo destinatário (quem pagou + chave Pix). Devolve também o total pedido.
 */
export async function validateBatch(
	db: Db,
	uid: string,
	items: BatchItemInput[],
): Promise<{ status: "ok"; totalCents: number } | Exclude<BatchPayResult, { status: "ok" | "all_failed" }>> {
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
	let recipient: string | null = null;
	let totalCents = 0;
	for (const i of items) {
		const e = docs.get(`${i.groupId}:${i.expenseId}`);
		if (!e) return { status: "no_expense" };
		if (!actsFor(members.get(i.groupId)!, uid, i.shareUid)) return { status: "forbidden" };
		const s = normalizeShares(e.shares).find((x) => x.uid === i.shareUid);
		if (!s || s.uid === e.paidBy || s.amountCents <= 0) return { status: "no_share" };
		const due = dueCents(s, e.paidBy);
		if (due <= 0) return { status: "invalid", error: "Uma dessas contas já foi paga. Atualize e tente de novo.", field: "items" };
		const key = recipientKey(e);
		if (recipient !== null && key !== recipient) {
			return { status: "invalid", error: "Escolha contas de um mesmo destinatário.", field: "items" };
		}
		recipient = key;
		totalCents += due;
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
	args: { uid: string; items: BatchItemInput[]; file?: SniffedFile; now?: Date },
): Promise<BatchPayResult> {
	const { uid, items, file } = args;
	const now = args.now ?? new Date();
	const checked = await validateBatch(db, uid, items);
	if (checked.status !== "ok") return checked;

	const batchId = randomId();
	const batch: ShareBatch = { id: batchId, totalCents: checked.totalCents, count: items.length };
	const receipt: AttachmentMeta | undefined = file
		? await putBatchReceipt(store, { batchId, bytes: file.bytes, name: file.name, contentType: file.contentType })
		: undefined;

	const result = new Map<string, BatchOutcome | BatchFailReason>();
	const paidDocs: { groupId: string; eid: string }[] = [];
	try {
		const byExpense = new Map<string, BatchItemInput[]>();
		for (const i of items) byExpense.set(`${i.groupId}:${i.expenseId}`, [...(byExpense.get(`${i.groupId}:${i.expenseId}`) ?? []), i]);
		for (const list of byExpense.values()) {
			const { groupId, expenseId } = list[0];
			const targets = list.map((i) => i.shareUid);
			let outcomes: BatchOutcome[] = [];
			const r = await mutateShares(db, groupId, expenseId, (e) => {
				const c = payShares(e.shares, e.paidBy, targets, now, uid, receipt, batch);
				outcomes = c.outcomes;
				return { shares: c.shares, changed: c.changed };
			});
			for (const i of list) {
				if (r.kind === "ok") result.set(itemId(i), outcomes.find((o) => o.uid === i.shareUid) ?? "not_found");
				else result.set(itemId(i), r.kind === "no_expense" ? "not_found" : "conflict");
			}
			if (r.kind === "ok" && r.wrote) paidDocs.push({ groupId, eid: expenseId });
		}
	} catch (err) {
		await releaseReceipts(db, store, receipt ? [receipt.key] : []);
		throw err;
	}

	const paid: BatchPaid[] = [];
	const failed: BatchFailed[] = [];
	for (const i of items) {
		const o = result.get(itemId(i));
		if (o && typeof o === "object" && o.result === "paid") paid.push({ ...i, amountCents: o.amountCents });
		else failed.push({ ...i, reason: typeof o === "string" ? o : (o?.result as BatchFailReason | undefined) ?? "conflict" });
	}
	const totalPaidCents = paid.reduce((t, p) => t + p.amountCents, 0);

	if (paid.length === 0) {
		await releaseReceipts(db, store, receipt ? [receipt.key] : []);
		return { status: "all_failed" };
	}
	if (failed.length > 0) await correctBatchTotals(db, uid, batchId, paidDocs, { id: batchId, totalCents: totalPaidCents, count: paid.length });
	return { status: "ok", batchId, paid, failed, totalPaidCents, hasReceipt: Boolean(receipt) };
}

/** Melhor esforço: ajusta o lote gravado ao que de fato foi pago. Se perder a corrida, fica o valor pedido. */
async function correctBatchTotals(db: Db, uid: string, batchId: string, docs: { groupId: string; eid: string }[], batch: ShareBatch) {
	for (const d of docs) {
		try {
			await mutateShares(db, d.groupId, d.eid, (e) => ({
				shares: e.shares.map((s) => (s.batch?.id === batchId && s.markedBy === uid ? { ...s, batch: { ...batch } } : s)),
				changed: e.shares.some((s) => s.batch?.id === batchId),
			}));
		} catch {
			console.error("payBatch totals error");
		}
	}
}
