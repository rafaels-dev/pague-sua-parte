import { formatBRL } from "@/lib/money";
import { describeItems, payAllLink } from "./pay-all";

/** "Quem me deve": o que ainda devem à pessoa, por devedor (formato de `GET /api/me/receivables`). */

export type ReceivableItem = {
	/** "refund" = a receber de volta: a pessoa pagou a mais e quem pagou a despesa vai devolver. */
	kind: "share" | "refund";
	groupId: string;
	groupName: string;
	expenseId: string;
	description: string;
	dueCents: number;
	dueDate: string | null;
	overdue: boolean;
	installment: { number: number; count: number } | null;
	recurrence: boolean;
	/** O dinheiro vai para você (false = vai para uma pessoa sem celular que você cuida). */
	payeeIsYou: boolean;
	payeeName: string;
};

export type Debtor = {
	uid: string;
	name: string;
	picture: string | null;
	kind: "user" | "managed";
	managedByName: string | null;
	youManage: boolean;
	totalCents: number;
	overdueCents: number;
	items: ReceivableItem[];
};

export type Receivables = {
	debtors: Debtor[];
	totalCents: number;
	/** Parte do total sem vencimento ou vencendo até o fim do mês. */
	nowCents: number;
	/** Parte do total que vai para quem você cuida. */
	managedCents: number;
	truncated: boolean;
};

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function normalizeItem(raw: unknown): ReceivableItem | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.groupId !== "string" || typeof r.expenseId !== "string") return null;
	const inst = r.installment && typeof r.installment === "object" ? (r.installment as Record<string, unknown>) : null;
	const number = inst ? num(inst.number) : 0;
	const count = inst ? num(inst.count) : 0;
	return {
		kind: r.kind === "refund" ? "refund" : "share",
		groupId: r.groupId,
		groupName: str(r.groupName),
		expenseId: r.expenseId,
		description: str(r.description),
		dueCents: Math.max(0, num(r.dueCents)),
		dueDate: typeof r.dueDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.dueDate) ? r.dueDate.slice(0, 10) : null,
		overdue: !!r.overdue,
		installment: number >= 1 && count >= 1 ? { number, count } : null,
		recurrence: !!r.recurrence,
		payeeIsYou: r.payeeIsYou !== false,
		payeeName: str(r.payeeName),
	};
}

/** Aceita a resposta de `/api/me/receivables`; descarta o que não dá para mostrar e completa o que falta. */
export function normalizeReceivables(raw: unknown): Receivables {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const debtors: Debtor[] = [];
	for (const entry of Array.isArray(r.debtors) ? r.debtors : []) {
		if (!entry || typeof entry !== "object") continue;
		const d = entry as Record<string, unknown>;
		const items = (Array.isArray(d.items) ? d.items : []).map(normalizeItem).filter((i): i is ReceivableItem => i !== null);
		if (items.length === 0) continue;
		const kind = d.kind === "managed" ? "managed" : "user";
		debtors.push({
			uid: str(d.uid) || `d${debtors.length}`,
			name: str(d.name, "Participante"),
			picture: typeof d.picture === "string" ? d.picture : null,
			kind,
			managedByName: kind === "managed" && typeof d.managedByName === "string" && d.managedByName ? d.managedByName : null,
			youManage: kind === "managed" && d.youManage === true,
			totalCents: typeof d.totalCents === "number" && Number.isFinite(d.totalCents) ? d.totalCents : items.reduce((s, i) => s + i.dueCents, 0),
			overdueCents: typeof d.overdueCents === "number" && Number.isFinite(d.overdueCents) ? d.overdueCents : items.filter((i) => i.overdue).reduce((s, i) => s + i.dueCents, 0),
			items,
		});
	}
	const sum = debtors.reduce((s, d) => s + d.totalCents, 0);
	const totalCents = typeof r.totalCents === "number" && Number.isFinite(r.totalCents) ? r.totalCents : sum;
	return {
		debtors,
		totalCents,
		nowCents: typeof r.nowCents === "number" && Number.isFinite(r.nowCents) ? r.nowCents : totalCents,
		managedCents: num(r.managedCents),
		truncated: r.truncated === true,
	};
}

/** Primeiro nome: "Maria das Dores Silva" vira "Maria". */
export function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? "";
}

/** Legenda de quem não tem celular: "Sem celular · quem cuida: Renata" ou "Sem celular · você cuida". null para quem tem celular. */
export function debtorCaption(d: Pick<Debtor, "kind" | "youManage" | "managedByName">): string | null {
	if (d.kind !== "managed") return null;
	if (d.youManage) return "Sem celular · você cuida";
	return d.managedByName ? `Sem celular · quem cuida: ${d.managedByName}` : "Sem celular";
}

/** Quem recebe quando não é você: "para Benjamim"; null quando o dinheiro é seu. */
/** Etiqueta de um item que é devolução. */
export const REFUND_BACK_CHIP = "A receber de volta";

export function payeeNote(i: Pick<ReceivableItem, "payeeIsYou" | "payeeName">): string | null {
	return i.payeeIsYou ? null : `para ${i.payeeName || "quem você cuida"}`;
}

/**
 * Mensagem curta para cobrar no WhatsApp: "Oi, Maria! Faltam R$ 172,48 das nossas despesas: A, B e C. Dá para pagar pelo app: link".
 * Pessoa sem celular com quem cuida: fala com quem cuida ("Oi, Renata! Faltam R$ X da parte de Benjamim ...").
 */
export function buildCollectText(d: Pick<Debtor, "name" | "kind" | "managedByName" | "totalCents" | "items">, link: string): string {
	const carer = d.kind === "managed" ? firstName(d.managedByName ?? "") : "";
	const who = d.kind === "managed" ? carer : firstName(d.name);
	const hello = who ? `Oi, ${who}!` : "Oi!";
	const part = d.kind === "managed" ? ` da parte de ${firstName(d.name) || "quem você cuida"}` : "";
	const list = describeItems(d.items.map((i) => i.description));
	return `${hello} Faltam ${formatBRL(d.totalCents)}${part} das nossas despesas${list ? `: ${list}` : ""}. Dá para pagar pelo app: ${link}`;
}

/** Link da mensagem: o grupo quando tudo é do mesmo grupo; senão, o início do app. */
export const collectLink = payAllLink;
