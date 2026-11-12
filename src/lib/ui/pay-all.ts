import { formatBRL } from "@/lib/money";
import { buildPixPayload } from "@/lib/pix/brcode";
import type { PixKeyType } from "@/lib/pix/key";

/** "Pagar tudo de uma vez": o que a pessoa tem a pagar agora, por quem recebe (formato de `GET /api/me/payables`). */

export type PayableItem = {
	/** "refund" = devolução: você devolve o que esta pessoa (`shareUid`) pagou a mais. */
	kind: "share" | "refund";
	groupId: string;
	groupName: string;
	expenseId: string;
	description: string;
	shareUid: string;
	shareName: string;
	/** A parte é sua (false = pessoa sem celular que você cuida). */
	isYou: boolean;
	dueCents: number;
	dueDate: string | null;
	overdue: boolean;
	installment: { number: number; count: number } | null;
	recurrence: boolean;
};

export type PayableRecipient = {
	id: string;
	payee: { uid: string; name: string; picture: string | null; kind: "user" | "managed" };
	pix: { type: PixKeyType; key: string; payeeName: string };
	totalCents: number;
	items: PayableItem[];
};

export type FailReason = "conflict" | "already_paid" | "not_found";

export type BatchResult = {
	batchId: string;
	paid: { kind: "share" | "refund"; groupId: string; expenseId: string; shareUid: string; amountCents: number }[];
	failed: { kind: "share" | "refund"; groupId: string; expenseId: string; shareUid: string; reason: FailReason }[];
	totalPaidCents: number;
	hasReceipt: boolean;
};

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const PIX_TYPES: PixKeyType[] = ["cpf", "cnpj", "email", "phone", "random"];

/** Identifica um item (a parte de uma pessoa numa despesa). */
export function itemKey(i: Pick<PayableItem, "groupId" | "expenseId" | "shareUid"> & { kind?: "share" | "refund" }): string {
	return `${i.groupId}:${i.expenseId}:${i.shareUid}:${i.kind === "refund" ? "refund" : "share"}`;
}

function normalizeItem(raw: unknown): PayableItem | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.groupId !== "string" || typeof r.expenseId !== "string" || typeof r.shareUid !== "string") return null;
	const inst = r.installment && typeof r.installment === "object" ? (r.installment as Record<string, unknown>) : null;
	const number = inst ? num(inst.number) : 0;
	const count = inst ? num(inst.count) : 0;
	return {
		kind: r.kind === "refund" ? "refund" : "share",
		groupId: r.groupId,
		groupName: str(r.groupName),
		expenseId: r.expenseId,
		description: str(r.description),
		shareUid: r.shareUid,
		shareName: str(r.shareName),
		isYou: !!r.isYou,
		dueCents: Math.max(0, num(r.dueCents)),
		dueDate: typeof r.dueDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.dueDate) ? r.dueDate.slice(0, 10) : null,
		overdue: !!r.overdue,
		installment: number >= 1 && count >= 1 ? { number, count } : null,
		recurrence: !!r.recurrence,
	};
}

/** Aceita a resposta de `/api/me/payables`; descarta o que não dá para mostrar e completa o que falta. */
export function normalizePayables(raw: unknown): PayableRecipient[] {
	const list = raw && typeof raw === "object" && Array.isArray((raw as { recipients?: unknown }).recipients) ? ((raw as { recipients: unknown[] }).recipients) : [];
	const out: PayableRecipient[] = [];
	for (const entry of list) {
		if (!entry || typeof entry !== "object") continue;
		const r = entry as Record<string, unknown>;
		const payee = (r.payee && typeof r.payee === "object" ? r.payee : {}) as Record<string, unknown>;
		const pix = (r.pix && typeof r.pix === "object" ? r.pix : {}) as Record<string, unknown>;
		const items = (Array.isArray(r.items) ? r.items : []).map(normalizeItem).filter((i): i is PayableItem => i !== null);
		if (items.length === 0) continue;
		const uid = str(payee.uid);
		out.push({
			id: str(r.id) || uid || `r${out.length}`,
			payee: { uid, name: str(payee.name, "Quem recebe"), picture: typeof payee.picture === "string" ? payee.picture : null, kind: payee.kind === "managed" ? "managed" : "user" },
			pix: {
				type: PIX_TYPES.includes(pix.type as PixKeyType) ? (pix.type as PixKeyType) : "random",
				key: str(pix.key),
				payeeName: str(pix.payeeName) || str(payee.name),
			},
			totalCents: typeof r.totalCents === "number" && Number.isFinite(r.totalCents) ? r.totalCents : items.reduce((s, i) => s + i.dueCents, 0),
			items,
		});
	}
	return out;
}

const REASONS: FailReason[] = ["conflict", "already_paid", "not_found"];

/** Resposta de `POST /api/me/payments` com valores seguros por padrão. */
export function normalizeBatchResult(raw: unknown): BatchResult {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const ref = (e: unknown) => {
		const x = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
		return { kind: x.kind === "refund" ? ("refund" as const) : ("share" as const), groupId: str(x.groupId), expenseId: str(x.expenseId), shareUid: str(x.shareUid) };
	};
	const paid = (Array.isArray(r.paid) ? r.paid : []).map((e) => ({ ...ref(e), amountCents: num((e as Record<string, unknown> | null)?.amountCents) }));
	const failed = (Array.isArray(r.failed) ? r.failed : []).map((e) => {
		const reason = (e as Record<string, unknown> | null)?.reason;
		return { ...ref(e), reason: REASONS.includes(reason as FailReason) ? (reason as FailReason) : "conflict" };
	});
	return {
		batchId: str(r.batchId),
		paid,
		failed,
		totalPaidCents: typeof r.totalPaidCents === "number" && Number.isFinite(r.totalPaidCents) ? r.totalPaidCents : paid.reduce((s, p) => s + p.amountCents, 0),
		hasReceipt: !!r.hasReceipt,
	};
}

/** Itens marcados (todos, menos os desmarcados). */
export function selectedItems(items: PayableItem[], unchecked: readonly string[]): PayableItem[] {
	return items.filter((i) => !unchecked.includes(itemKey(i)));
}

/** Soma do que está marcado, em centavos. */
export function selectedTotal(items: PayableItem[], unchecked: readonly string[]): number {
	return selectedItems(items, unchecked).reduce((s, i) => s + i.dueCents, 0);
}

/** Marca/desmarca um item. */
export function toggleUnchecked(unchecked: readonly string[], key: string): string[] {
	return unchecked.includes(key) ? unchecked.filter((k) => k !== key) : [...unchecked, key];
}

/** Código Pix Copia e Cola do total marcado; null se os dados não permitem gerar. */
export function payAllPayload(r: Pick<PayableRecipient, "pix">, amountCents: number): string | null {
	try {
		return buildPixPayload({ key: r.pix.key, payeeName: r.pix.payeeName, amountCents, txid: "RPAGARTUDO" });
	} catch {
		return null;
	}
}

/** O código gerado vale só para o valor em que foi gerado: mudou a seleção, ele some. */
export function pixIsCurrent(generatedCents: number | null, currentCents: number): boolean {
	return generatedCents !== null && generatedCents === currentCents && currentCents > 0;
}

/** Motivo de uma conta não ter sido marcada, em palavras simples. */
export function failReasonText(reason: FailReason): string {
	switch (reason) {
		case "already_paid":
			return "já estava paga";
		case "not_found":
			return "não existe mais";
		default:
			return "mudou agora há pouco";
	}
}

/** Etiqueta de uma conta que é devolução. */
export const REFUND_CHIP = "Devolução";

/** Pedido de pagamento em lote: cada conta com o seu tipo (parte a pagar ou devolução). */
export function batchRequestItems(items: Pick<PayableItem, "groupId" | "expenseId" | "shareUid" | "kind">[]) {
	return items.map(({ groupId, expenseId, shareUid, kind }) => ({ groupId, expenseId, shareUid, ...(kind === "refund" ? { kind } : {}) }));
}

/** Final da chave Pix para distinguir dois cartões da mesma pessoa: "terminada em 1234" (e-mail e chaves curtas aparecem inteiros no Pix). */
export function pixTail(key: string): string {
	const t = key.trim();
	return t.length > 4 ? `Chave Pix terminada em ${t.slice(-4)}` : `Chave Pix ${t}`;
}

/** Ids dos destinatários cuja pessoa aparece em mais de um cartão (chaves Pix diferentes): esses cartões levam o final da chave. */
export function ambiguousRecipientIds(recipients: Pick<PayableRecipient, "id" | "payee">[]): Set<string> {
	const count = new Map<string, number>();
	for (const r of recipients) count.set(r.payee.uid, (count.get(r.payee.uid) ?? 0) + 1);
	return new Set(recipients.filter((r) => (count.get(r.payee.uid) ?? 0) > 1).map((r) => r.id));
}

/** "1 conta" / "3 contas". */
export function accountsLabel(n: number): string {
	return n === 1 ? "1 conta" : `${n} contas`;
}

/** "3 de 4 contas marcadas". */
export function selectionLabel(selected: number, total: number): string {
	if (selected === 0) return "Nenhuma conta marcada";
	if (selected === total) return total === 1 ? "1 conta" : `Todas as ${total} contas`;
	return `${selected} de ${total} contas marcadas`;
}

function cleanDescription(d: string): string {
	return d.trim().replace(/[\s.]+$/, "");
}

function joinList(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? "";
	return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** Descrições sem repetição; com mais de 4, as 3 primeiras e "+ N outras". */
export function describeItems(descriptions: string[]): string {
	const unique = [...new Set(descriptions.map(cleanDescription).filter(Boolean))];
	if (unique.length > 4) {
		const rest = unique.length - 3;
		return `${unique.slice(0, 3).join(", ")} + ${rest} ${rest === 1 ? "outra" : "outras"}`;
	}
	return joinList(unique);
}

/**
 * Mensagem para avisar que pagou várias contas de uma vez.
 * `forNames`: nomes das pessoas sem celular pagas junto (vazio = só as suas); `allManaged`: nenhuma parte era sua.
 */
export function buildPayAllShareText(
	p: { totalCents: number; descriptions: string[]; expenseCount: number; forNames: string[]; allManaged: boolean; hasReceipt: boolean },
	link: string,
): string {
	const names = [...new Set(p.forNames)];
	const whose = names.length === 0 ? "" : p.allManaged ? `, as partes de ${joinList(names)}` : `, as minhas partes e as de ${joinList(names)}`;
	const count = Math.max(1, p.expenseCount);
	const about = count === 1 ? "referente a 1 despesa" : `referentes a ${count} despesas`;
	const list = describeItems(p.descriptions);
	const see = p.hasReceipt ? "Veja o comprovante:" : "Confira aqui:";
	return `Paguei ${formatBRL(p.totalCents)} de uma vez${whose}, ${about}${list ? `: ${list}` : ""}. ${see} ${link}`;
}

/** Link da mensagem: a página do grupo quando tudo é do mesmo grupo; senão, o início do app. */
export function payAllLink(origin: string, items: Pick<PayableItem, "groupId">[]): string {
	const base = origin.replace(/\/+$/, "");
	const groups = new Set(items.map((i) => i.groupId));
	if (groups.size === 1) return `${base}/app/grupos/${encodeURIComponent([...groups][0])}`;
	return `${base}/app`;
}

/** Dados da mensagem a partir dos itens que foram pagos. */
export function shareFieldsFor(items: PayableItem[]): { descriptions: string[]; expenseCount: number; forNames: string[]; allManaged: boolean } {
	return {
		descriptions: items.map((i) => i.description),
		expenseCount: new Set(items.map((i) => `${i.groupId}:${i.expenseId}`)).size,
		forNames: items.filter((i) => !i.isYou).map((i) => i.shareName),
		allManaged: items.length > 0 && items.every((i) => !i.isYou),
	};
}

/** Tira dos recipientes as partes já pagas e refaz os totais; quem ficou sem nada some. */
export function removePaid(recipients: PayableRecipient[], paidKeys: ReadonlySet<string>): PayableRecipient[] {
	return recipients
		.map((r) => {
			const items = r.items.filter((i) => !paidKeys.has(itemKey(i)));
			return { ...r, items, totalCents: items.reduce((s, i) => s + i.dueCents, 0) };
		})
		.filter((r) => r.items.length > 0);
}

/** "Pago junto com outras 2 contas (R$ 350,00 no total)"; null quando foi paga sozinha. `count` inclui esta parte. */
export function batchCaption(batch: { totalCents: number; count: number } | null | undefined): string | null {
	if (!batch || batch.count < 2) return null;
	const others = batch.count - 1;
	return `Pago junto com ${others === 1 ? "outra conta" : `outras ${others} contas`} (${formatBRL(batch.totalCents)} no total)`;
}

/** `batch` de uma parte vindo da API; qualquer coisa estranha vira null. */
export function normalizeBatch(raw: unknown): { totalCents: number; count: number } | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.totalCents !== "number" || !Number.isFinite(r.totalCents) || typeof r.count !== "number" || !Number.isFinite(r.count) || r.count < 1) return null;
	return { totalCents: r.totalCents, count: r.count };
}
