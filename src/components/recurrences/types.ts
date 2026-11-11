export type Recurrence = {
	id: string;
	description: string;
	amountCents: number;
	dayOfMonth: number;
	participantMode: "all" | "selected" | "alone";
	participantUids: string[];
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean; kind: "user" | "managed"; youManage: boolean };
	startPeriod: string;
	endPeriod: string | null;
	nextDueDate: string;
	canEdit: boolean;
};

const periodOrNull = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);

/** Completa o que faltar num item da lista de despesas fixas, para a tela nunca quebrar. Sem id, devolve null. */
export function normalizeRecurrence(raw: unknown): Recurrence | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || !r.id) return null;
	const paid = (r.paidBy && typeof r.paidBy === "object" ? r.paidBy : {}) as Record<string, unknown>;
	const day = typeof r.dayOfMonth === "number" && Number.isFinite(r.dayOfMonth) ? Math.min(31, Math.max(1, Math.trunc(r.dayOfMonth))) : 1;
	const kind = paid.kind === "managed" ? "managed" : "user";
	return {
		id: r.id,
		description: typeof r.description === "string" ? r.description : "",
		amountCents: typeof r.amountCents === "number" && Number.isFinite(r.amountCents) ? r.amountCents : 0,
		dayOfMonth: day,
		participantMode: r.participantMode === "selected" || r.participantMode === "alone" ? r.participantMode : "all",
		participantUids: Array.isArray(r.participantUids) ? r.participantUids.filter((u): u is string => typeof u === "string") : [],
		paidBy: {
			uid: typeof paid.uid === "string" ? paid.uid : "",
			name: typeof paid.name === "string" ? paid.name : "",
			picture: typeof paid.picture === "string" ? paid.picture : null,
			isYou: !!paid.isYou,
			kind,
			youManage: kind === "managed" && !!paid.youManage,
		},
		startPeriod: periodOrNull(r.startPeriod) ?? "",
		endPeriod: periodOrNull(r.endPeriod),
		nextDueDate: typeof r.nextDueDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.nextDueDate) ? r.nextDueDate.slice(0, 10) : "",
		canEdit: !!r.canEdit,
	};
}

/** Lista de despesas fixas vinda da API (`{ recurrences: [...] }`); formato inesperado vira lista vazia. */
export function normalizeRecurrences(raw: unknown): Recurrence[] {
	const list = raw && typeof raw === "object" ? (raw as { recurrences?: unknown }).recurrences : null;
	if (!Array.isArray(list)) return [];
	return list.map(normalizeRecurrence).filter((r): r is Recurrence => r !== null);
}

/** Marca de uma despesa criada por uma despesa fixa. */
export type RecurrenceRef = { id: string; period: string };

export function normalizeRecurrenceRef(raw: unknown): RecurrenceRef | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || !r.id) return null;
	return { id: r.id, period: periodOrNull(r.period) ?? "" };
}
