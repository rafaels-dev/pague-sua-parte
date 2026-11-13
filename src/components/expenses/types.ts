import type { ShareStatus, YourStatus } from "@/lib/ui/expense-status";
import type { PixKeyType } from "@/lib/pix/key";
import type { ManagedShareSummary, OwnerView } from "@/lib/ui/managed";
import { normalizeBatch } from "@/lib/ui/pay-all";
import { normalizeRecurrenceRef, type RecurrenceRef } from "@/components/recurrences/types";

export type { RecurrenceRef };

export type ExpenseSummary = {
	id: string;
	description: string;
	amountCents: number;
	date: string;
	/** `youManage`: quem pagou é uma pessoa sem celular que você cuida. */
	paidBy: { uid: string; name: string; isYou: boolean; youManage: boolean };
	yourShareCents: number;
	yourStatus: YourStatus;
	/** Quanto falta a pessoa pagar (pode ser menos que a parte, se já pagou algo). */
	yourDueCents: number;
	/** Quanto a pessoa tem a receber de volta do dono. */
	yourRefundCents: number;
	/** Quanto você já pagou da sua parte (pagamento parcial). */
	yourPaidCents: number;
	pendingCount: number;
	refundCount: number;
	/** Quantas partes em aberto já têm pagamento parcial. */
	partialCount: number;
	attachmentCount: number;
	/** Partes das pessoas sem celular que você cuida (só as que participam). */
	managed: ManagedShareSummary[];
	/** Quando você age por quem pagou (pessoa sem celular): o que falta receber e devolver. */
	ownerView: OwnerView | null;
	/** Vencimento (compra no cartão ou parcela); null = sem data. */
	dueDate: string | null;
	/** Parcela de uma compra parcelada; null = despesa comum. */
	installment: InstallmentRef | null;
	/** Criada por uma despesa fixa (todo mês); null = despesa comum. */
	recurrence: RecurrenceRef | null;
	/** Venceu e ainda está em aberto. */
	overdue: boolean;
	/** Nada mais a pagar nem a devolver (vai para "Quitadas"). */
	settled: boolean;
	/** Você pode entrar na divisão ("Quero ajudar"). */
	canHelp: boolean;
	/** Quem pagou está arcando com a despesa sozinho. */
	ownerAlone: boolean;
	/** Quanto ficaria a parte de quem entrar na divisão. */
	helpShareCents: number | null;
};

export type InstallmentRef = { seriesId: string; number: number; count: number };

export type SeriesItem = { id: string; number: number; dueDate: string | null; settled: boolean; /** Já recebeu pagamento parcial, mas ainda falta (nunca conta como quitada). */ partial?: boolean; amountCents?: number };

export type ExpenseSeries = { count: number; items: SeriesItem[] };

export type ShareReceipt = { name: string; contentType: string; size: number };

/** Um pagamento parcial já feito na parte (histórico); `receipt` só vem se você pode vê-lo. */
export type SharePartInfo = {
	id: string;
	cents: number;
	at: string;
	method: "manual" | "self";
	byAdmin: boolean;
	markedByName: string | null;
	receipt: ShareReceipt | null;
	batch: { totalCents: number; count: number } | null;
};

export type ExpenseShare = {
	uid: string;
	name: string;
	picture: string | null;
	/** Parte atual da pessoa (0 para quem saiu da divisão). */
	amountCents: number;
	/** Quanto a pessoa já pagou ao dono. */
	paidCents: number;
	/** Quanto ainda falta pagar. */
	dueCents: number;
	/** Quanto o dono deve devolver a ela. */
	refundCents: number;
	/** false = saiu da divisão mas ainda tem dinheiro a receber de volta. */
	participates: boolean;
	status: ShareStatus;
	isYou: boolean;
	/** "managed" = pessoa sem celular. */
	kind: "user" | "managed";
	/** Você é o responsável por esta pessoa. */
	youManage: boolean;
	managedByName: string | null;
	paidAt: string | null;
	/** "self" = a própria pessoa avisou que pagou; "manual" = quem pagou a conta marcou. */
	method: "manual" | "self" | null;
	/** Comprovante de pagamento; só vem preenchido se você pode vê-lo. */
	receipt: ShareReceipt | null;
	/** Pagamentos parciais ainda não quitados (do mais antigo ao mais novo). */
	parts: SharePartInfo[];
	/** Você pode desfazer o último pagamento parcial que avisou nesta parte. */
	canUndoOwnPart: boolean;
	/** O ÚLTIMO pagamento (o que "Desfazer" tira); null = nenhum. */
	last: { cents: number; method: "manual" | "self" | null; partial: boolean } | null;
	/** Você pode tocar em "Já paguei" nesta parte. */
	canPay: boolean;
	/** A parte está paga e você ainda pode anexar ou trocar o comprovante. */
	canAddReceipt: boolean;
	/** Entrou na divisão depois, pelo "Quero ajudar". */
	helped: boolean;
	/** Paga junto com outras contas, num Pix só (`count` inclui esta parte); null = paga sozinha. */
	batch: { totalCents: number; count: number } | null;
	/** "manual" marcado pelo administrador do grupo (e não por quem pagou a conta). */
	markedByAdmin: boolean;
	markedByName: string | null;
	/** A devolução do que a pessoa pagou a mais já foi feita. */
	refund: ShareRefundInfo | null;
	/** Você (quem pagou ou o administrador) pode marcar "Devolvi" / desfazer a devolução. */
	canRefund: boolean;
	canUndoRefund: boolean;
	/** Chave Pix de quem recebe de volta; só para quem paga a devolução. null = a pessoa não tem chave; undefined = não é você quem paga. */
	refundPix?: { type: PixKeyType; key: string; payeeName: string } | null;
};

export type ShareRefundInfo = {
	cents: number;
	at: string;
	byAdmin: boolean;
	markedByName: string | null;
	receipt: ShareReceipt | null;
	batch: { totalCents: number; count: number } | null;
};

export type ExpenseAttachment = { id: string; name: string; contentType: string; size: number };

export type ExpenseDetailData = {
	id: string;
	groupId: string;
	description: string;
	/** Valor que se divide (já sem o cashback). */
	amountCents: number;
	/** Cashback desta despesa/parcela; 0 = não teve. A compra custou `amountCents + cashbackCents`. */
	cashbackCents?: number;
	date: string;
	createdAt: string;
	canDelete: boolean;
	canMarkPaid: boolean;
	canEditParticipants: boolean;
	/** Você pode editar a despesa (quem pagou ou o administrador do grupo). */
	canEdit: boolean;
	/** Você só gerencia esta despesa por ser administrador do grupo (não foi você quem pagou). */
	adminOnly: boolean;
	participantUids: string[];
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean; kind: "user" | "managed"; youManage: boolean };
	/** `null` = quem pagou ainda não cadastrou a chave Pix: ninguém consegue pagar pelo app até ela existir. */
	pix: { type: PixKeyType; key: string; payeeName: string } | null;
	/** Quem lançou, quando não é quem pagou (o administrador lançando por outra pessoa). */
	launchedBy: { name: string; admin: boolean } | null;
	shares: ExpenseShare[];
	attachments: ExpenseAttachment[];
	dueDate: string | null;
	installment: InstallmentRef | null;
	/** Criada por uma despesa fixa (todo mês); null = despesa comum. */
	recurrence: RecurrenceRef | null;
	/** Nasceu de um plano (código dele, para o link "Ver o plano"); opcional nas telas de exemplo. */
	planId?: string | null;
	overdue: boolean;
	/** Todas as parcelas da compra (só quando é parcelada). */
	series: ExpenseSeries | null;
	/** Você pode entrar na divisão ("Quero ajudar"). */
	canHelp: boolean;
	/** Pessoas sem celular que você cuida e que também poderiam ajudar. */
	helpAsUids: string[];
	/** Quanto ficaria a parte de quem entrar na divisão. */
	helpShareCents: number | null;
	/** Quem pagou está arcando com a despesa sozinho. */
	ownerAlone: boolean;
};

function normalizeInstallment(raw: unknown): InstallmentRef | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const number = typeof r.number === "number" ? r.number : 0;
	const count = typeof r.count === "number" ? r.count : 0;
	if (number < 1 || count < 1) return null;
	return { seriesId: typeof r.seriesId === "string" ? r.seriesId : "", number, count };
}

function normalizeSeries(raw: unknown): ExpenseSeries | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (!Array.isArray(r.items)) return null;
	const items: SeriesItem[] = (r.items as Record<string, unknown>[])
		.filter((i) => i && typeof i.id === "string" && typeof i.number === "number")
		.map((i) => ({ id: i.id as string, number: i.number as number, dueDate: typeof i.dueDate === "string" ? i.dueDate : null, settled: !!i.settled, ...(i.partial === true ? { partial: true } : {}), ...(typeof i.amountCents === "number" ? { amountCents: i.amountCents } : {}) }))
		.sort((a, b) => a.number - b.number);
	if (items.length === 0) return null;
	return { count: typeof r.count === "number" ? r.count : items.length, items };
}

/** Comprovante vindo da API; qualquer coisa sem nome vira "sem comprovante". */
export function normalizeReceipt(raw: unknown): ShareReceipt | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.name !== "string" || !r.name) return null;
	return { name: r.name, contentType: typeof r.contentType === "string" ? r.contentType : "", size: typeof r.size === "number" ? r.size : 0 };
}

function normalizePart(raw: unknown): SharePartInfo | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || !r.id || typeof r.cents !== "number" || r.cents <= 0) return null;
	return {
		id: r.id,
		cents: r.cents,
		at: typeof r.at === "string" ? r.at : "",
		method: r.method === "self" ? "self" : "manual",
		byAdmin: r.byAdmin === true,
		markedByName: typeof r.markedByName === "string" ? r.markedByName : null,
		receipt: normalizeReceipt(r.receipt),
		batch: normalizeBatch(r.batch),
	};
}

function normalizeRefund(raw: unknown): ShareRefundInfo | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.cents !== "number" || r.cents <= 0) return null;
	return {
		cents: r.cents,
		at: typeof r.at === "string" ? r.at : "",
		byAdmin: r.byAdmin === true,
		markedByName: typeof r.markedByName === "string" ? r.markedByName : null,
		receipt: normalizeReceipt(r.receipt),
		batch: normalizeBatch(r.batch),
	};
}

const dueOrNull = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

const helpShare = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

type Loose<T> = { [K in keyof T]?: T[K] };

/** Aceita uma despesa no formato antigo (sem os campos de devolução) e completa o que falta, para a tela nunca quebrar. */
export function normalizeExpense(raw: Loose<Omit<ExpenseDetailData, "shares">> & { shares?: Loose<ExpenseShare>[] } & Record<string, unknown>): ExpenseDetailData {
	const shares: ExpenseShare[] = (raw.shares ?? []).map((s) => {
		const amountCents = s.amountCents ?? 0;
		const status = s.status ?? "pending";
		const paidCents = s.paidCents ?? (status === "paid" || status === "payer" ? amountCents : 0);
		return {
			uid: s.uid ?? "",
			name: s.name ?? "",
			picture: s.picture ?? null,
			isYou: !!s.isYou,
			kind: s.kind === "managed" ? "managed" : "user",
			youManage: s.kind === "managed" && !!s.youManage,
			managedByName: s.managedByName ?? null,
			amountCents,
			paidCents,
			dueCents: s.dueCents ?? (status === "pending" ? Math.max(0, amountCents - paidCents) : 0),
			refundCents: s.refundCents ?? 0,
			participates: s.participates ?? true,
			status,
			paidAt: s.paidAt ?? null,
			method: s.method === "self" || s.method === "manual" ? s.method : null,
			receipt: normalizeReceipt(s.receipt),
			parts: Array.isArray(s.parts) ? (s.parts as unknown[]).map(normalizePart).filter((p): p is SharePartInfo => p !== null) : [],
			canUndoOwnPart: !!s.canUndoOwnPart,
			last: s.last && typeof s.last.cents === "number" && s.last.cents > 0 ? { cents: s.last.cents, method: s.last.method === "self" ? "self" : s.last.method === "manual" ? "manual" : null, partial: !!s.last.partial } : null,
			canPay: !!s.canPay,
			canAddReceipt: !!s.canAddReceipt,
			helped: !!s.helped,
			batch: normalizeBatch(s.batch),
			markedByAdmin: s.method === "manual" && !!s.markedByAdmin,
			markedByName: typeof s.markedByName === "string" ? s.markedByName : null,
			refund: normalizeRefund(s.refund),
			canRefund: !!s.canRefund,
			canUndoRefund: !!s.canUndoRefund,
			...(s.refundPix === null ? { refundPix: null } : s.refundPix && typeof s.refundPix.key === "string" ? { refundPix: { type: s.refundPix.type, key: s.refundPix.key, payeeName: s.refundPix.payeeName ?? "" } } : {}),
		};
	});
	const paidBy = (raw.paidBy ?? { uid: "", name: "", picture: null, isYou: false }) as Loose<ExpenseDetailData["paidBy"]>;
	return {
		...(raw as unknown as ExpenseDetailData),
		paidBy: {
			uid: paidBy.uid ?? "",
			name: paidBy.name ?? "",
			picture: paidBy.picture ?? null,
			isYou: !!paidBy.isYou,
			kind: paidBy.kind === "managed" ? "managed" : "user",
			youManage: paidBy.kind === "managed" && !!paidBy.youManage,
		},
		shares,
		pix: validPix(raw.pix),
		launchedBy: raw.launchedBy && typeof raw.launchedBy.name === "string" ? { name: raw.launchedBy.name, admin: !!raw.launchedBy.admin } : null,
		attachments: raw.attachments ?? [],
		dueDate: dueOrNull(raw.dueDate),
		installment: normalizeInstallment(raw.installment),
		recurrence: normalizeRecurrenceRef(raw.recurrence),
		cashbackCents: typeof raw.cashbackCents === "number" && raw.cashbackCents > 0 ? raw.cashbackCents : 0,
		planId: typeof raw.planId === "string" ? raw.planId : null,
		overdue: !!raw.overdue,
		series: normalizeSeries(raw.series),
		helpAsUids: Array.isArray(raw.helpAsUids) ? (raw.helpAsUids as unknown[]).filter((u): u is string => typeof u === "string") : [],
		canHelp: !!raw.canHelp,
		helpShareCents: helpShare(raw.helpShareCents),
		ownerAlone: !!raw.ownerAlone,
		canDelete: !!raw.canDelete,
		canMarkPaid: !!raw.canMarkPaid,
		canEditParticipants: raw.canEditParticipants ?? false,
		canEdit: !!raw.canEdit,
		adminOnly: !!raw.adminOnly,
		participantUids: raw.participantUids ?? shares.filter((s) => s.participates).map((s) => s.uid),
	};
}

const PIX_TYPES = ["cpf", "cnpj", "email", "phone", "random"];
/** Chave Pix completa (tipo conhecido, chave e nome de quem recebe) ou null: um objeto incompleto nunca chega às telas de pagar. */
export function validPix(v: unknown): ExpenseDetailData["pix"] {
	if (!v || typeof v !== "object") return null;
	const p = v as Record<string, unknown>;
	if (typeof p.type !== "string" || !PIX_TYPES.includes(p.type) || typeof p.key !== "string" || p.key.trim() === "" || typeof p.payeeName !== "string") return null;
	return { type: p.type as PixKeyType, key: p.key, payeeName: p.payeeName };
}

/**
 * Chave Pix a copiar. Numa devolução (`refundKey` "r:<uid>") é só a de quem recebe de volta: sem ela, nada (nunca a chave
 * de quem pagou a despesa, que seria a de quem está devolvendo). Fora disso, a da despesa.
 */
export function keyToCopy(expense: Pick<ExpenseDetailData, "pix" | "shares">, refundKey?: string | null): string | null {
	if (refundKey?.startsWith("r:")) return expense.shares.find((s) => s.uid === refundKey.slice(2))?.refundPix?.key || null;
	return expense.pix?.key || null;
}

/** Completa os campos novos de um item da lista de despesas quando o servidor ainda manda o formato antigo. */
export function normalizeSummary(raw: Loose<ExpenseSummary> & Record<string, unknown>): ExpenseSummary {
	const pendingCount = raw.pendingCount ?? 0;
	const refundCount = raw.refundCount ?? 0;
	const yourStatus = raw.yourStatus ?? "none";
	const paidBy = (raw.paidBy ?? { uid: "", name: "", isYou: false }) as Loose<ExpenseSummary["paidBy"]>;
	const ownerView = raw.ownerView && typeof raw.ownerView === "object" ? raw.ownerView : null;
	return {
		...(raw as unknown as ExpenseSummary),
		paidBy: { uid: paidBy.uid ?? "", name: paidBy.name ?? "", isYou: !!paidBy.isYou, youManage: !!paidBy.youManage },
		managed: Array.isArray(raw.managed) ? raw.managed : [],
		ownerView: ownerView ? { pendingCount: ownerView.pendingCount ?? 0, refundCount: ownerView.refundCount ?? 0 } : null,
		yourShareCents: raw.yourShareCents ?? 0,
		yourDueCents: raw.yourDueCents ?? (raw.yourStatus === "pending" ? (raw.yourShareCents ?? 0) : 0),
		yourRefundCents: raw.yourRefundCents ?? 0,
		yourPaidCents: raw.yourPaidCents ?? 0,
		partialCount: raw.partialCount ?? 0,
		pendingCount,
		refundCount,
		attachmentCount: raw.attachmentCount ?? 0,
		yourStatus,
		dueDate: dueOrNull(raw.dueDate),
		installment: normalizeInstallment(raw.installment),
		recurrence: normalizeRecurrenceRef(raw.recurrence),
		overdue: !!raw.overdue,
		canHelp: !!raw.canHelp,
		ownerAlone: !!raw.ownerAlone,
		helpShareCents: helpShare(raw.helpShareCents),
		// Servidor antigo: quitada = ninguém deve nem recebe de volta.
		settled: typeof raw.settled === "boolean" ? raw.settled : pendingCount === 0 && refundCount === 0 && yourStatus !== "pending" && yourStatus !== "refund",
	};
}

/** Recado curto entre telas (ex.: "Despesa lançada!"), guardado só até a próxima tela mostrá-lo. */
const FLASH_KEY = "pague-sua-parte:flash";

export function setFlash(message: string): void {
	try {
		sessionStorage.setItem(FLASH_KEY, message);
	} catch {
		// sem armazenamento: a tela seguinte simplesmente não mostra o recado
	}
}

/** Lê o recado sem apagá-lo (seguro de chamar na criação do estado). */
export function peekFlash(): string | null {
	try {
		return sessionStorage.getItem(FLASH_KEY);
	} catch {
		return null;
	}
}

export function clearFlash(): void {
	try {
		sessionStorage.removeItem(FLASH_KEY);
	} catch {
		// nada a limpar
	}
}
