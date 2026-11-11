import type { ShareStatus, YourStatus } from "@/lib/ui/expense-status";
import type { PixKeyType } from "@/lib/pix/key";
import type { ManagedShareSummary, OwnerView } from "@/lib/ui/managed";

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
	pendingCount: number;
	refundCount: number;
	attachmentCount: number;
	/** Partes das pessoas sem celular que você cuida (só as que participam). */
	managed: ManagedShareSummary[];
	/** Quando você age por quem pagou (pessoa sem celular): o que falta receber e devolver. */
	ownerView: OwnerView | null;
	/** Vencimento (compra no cartão ou parcela); null = sem data. */
	dueDate: string | null;
	/** Parcela de uma compra parcelada; null = despesa comum. */
	installment: InstallmentRef | null;
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

export type SeriesItem = { id: string; number: number; dueDate: string | null; settled: boolean };
export type ExpenseSeries = { count: number; items: SeriesItem[] };

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
	method: "manual" | null;
	/** Entrou na divisão depois, pelo "Quero ajudar". */
	helped: boolean;
};

export type ExpenseAttachment = { id: string; name: string; contentType: string; size: number };

export type ExpenseDetailData = {
	id: string;
	groupId: string;
	description: string;
	amountCents: number;
	date: string;
	createdAt: string;
	canDelete: boolean;
	canMarkPaid: boolean;
	canEditParticipants: boolean;
	participantUids: string[];
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean; kind: "user" | "managed"; youManage: boolean };
	pix: { type: PixKeyType; key: string; payeeName: string };
	shares: ExpenseShare[];
	attachments: ExpenseAttachment[];
	dueDate: string | null;
	installment: InstallmentRef | null;
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
		.map((i) => ({ id: i.id as string, number: i.number as number, dueDate: typeof i.dueDate === "string" ? i.dueDate : null, settled: !!i.settled }))
		.sort((a, b) => a.number - b.number);
	if (items.length === 0) return null;
	return { count: typeof r.count === "number" ? r.count : items.length, items };
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
			method: s.method ?? null,
			helped: !!s.helped,
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
		attachments: raw.attachments ?? [],
		dueDate: dueOrNull(raw.dueDate),
		installment: normalizeInstallment(raw.installment),
		overdue: !!raw.overdue,
		series: normalizeSeries(raw.series),
		helpAsUids: Array.isArray(raw.helpAsUids) ? (raw.helpAsUids as unknown[]).filter((u): u is string => typeof u === "string") : [],
		canHelp: !!raw.canHelp,
		helpShareCents: helpShare(raw.helpShareCents),
		ownerAlone: !!raw.ownerAlone,
		canDelete: !!raw.canDelete,
		canMarkPaid: !!raw.canMarkPaid,
		canEditParticipants: raw.canEditParticipants ?? false,
		participantUids: raw.participantUids ?? shares.filter((s) => s.participates).map((s) => s.uid),
	};
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
		pendingCount,
		refundCount,
		attachmentCount: raw.attachmentCount ?? 0,
		yourStatus,
		dueDate: dueOrNull(raw.dueDate),
		installment: normalizeInstallment(raw.installment),
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
