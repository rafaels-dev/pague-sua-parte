import type { ShareStatus, YourStatus } from "@/lib/ui/expense-status";
import type { PixKeyType } from "@/lib/pix/key";

export type ExpenseSummary = {
	id: string;
	description: string;
	amountCents: number;
	date: string;
	paidBy: { uid: string; name: string; isYou: boolean };
	yourShareCents: number;
	yourStatus: YourStatus;
	/** Quanto falta a pessoa pagar (pode ser menos que a parte, se já pagou algo). */
	yourDueCents: number;
	/** Quanto a pessoa tem a receber de volta do dono. */
	yourRefundCents: number;
	pendingCount: number;
	refundCount: number;
	attachmentCount: number;
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
	paidAt: string | null;
	method: "manual" | null;
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
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean };
	pix: { type: PixKeyType; key: string; payeeName: string };
	shares: ExpenseShare[];
	attachments: ExpenseAttachment[];
};

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
			amountCents,
			paidCents,
			dueCents: s.dueCents ?? (status === "pending" ? Math.max(0, amountCents - paidCents) : 0),
			refundCents: s.refundCents ?? 0,
			participates: s.participates ?? true,
			status,
			paidAt: s.paidAt ?? null,
			method: s.method ?? null,
		};
	});
	return {
		...(raw as unknown as ExpenseDetailData),
		shares,
		attachments: raw.attachments ?? [],
		canDelete: !!raw.canDelete,
		canMarkPaid: !!raw.canMarkPaid,
		canEditParticipants: raw.canEditParticipants ?? false,
		participantUids: raw.participantUids ?? shares.filter((s) => s.participates).map((s) => s.uid),
	};
}

/** Completa os campos novos de um item da lista de despesas quando o servidor ainda manda o formato antigo. */
export function normalizeSummary(raw: Loose<ExpenseSummary> & Record<string, unknown>): ExpenseSummary {
	return {
		...(raw as unknown as ExpenseSummary),
		yourShareCents: raw.yourShareCents ?? 0,
		yourDueCents: raw.yourDueCents ?? (raw.yourStatus === "pending" ? (raw.yourShareCents ?? 0) : 0),
		yourRefundCents: raw.yourRefundCents ?? 0,
		pendingCount: raw.pendingCount ?? 0,
		refundCount: raw.refundCount ?? 0,
		attachmentCount: raw.attachmentCount ?? 0,
		yourStatus: raw.yourStatus ?? "none",
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
