import { formatBRL } from "@/lib/money";
import type { Tone } from "./expense-status";

/** Quem aparece com "Sem celular": só o necessário para montar a legenda. */
export type ManagedLike = { kind?: "user" | "managed"; youManage?: boolean; managedByName?: string | null };

/** Parte de uma pessoa sem celular que a pessoa logada cuida, na lista de despesas. */
export type ManagedShareSummary = {
	uid: string;
	name: string;
	status: "payer" | "pending" | "paid" | "refund";
	dueCents: number;
	refundCents: number;
};

/** Quando a pessoa logada age por quem pagou a despesa (pessoa sem celular). */
export type OwnerView = { pendingCount: number; refundCount: number };

/** Saldo com o recorte "agora" (sem vencimento ou vencendo até o fim do mês) e o que já venceu. */
export type NowBalance = {
	toReceiveNowCents: number;
	toPayNowCents: number;
	overdueToPayCents: number;
};

export type MeSummary = {
	toReceiveCents: number;
	toPayCents: number;
	managed: ({ uid: string; name: string; groupId: string; groupName: string; toReceiveCents: number; toPayCents: number } & NowBalance)[];
} & NowBalance;

/** "Sem celular · aos cuidados de Renata", "Sem celular · você cuida" ou null para quem tem celular. */
export function managedCaption(p: ManagedLike): string | null {
	if (p.kind !== "managed") return null;
	if (p.youManage) return "Sem celular · você cuida";
	return p.managedByName ? `Sem celular · aos cuidados de ${p.managedByName}` : "Sem celular";
}

function plural(n: number, one: string, many: string): string {
	return n === 1 ? one : many;
}

/** Linhas extras da lista de despesas: o que as pessoas que você cuida devem ou têm a receber de volta. */
export function managedLines(managed: ManagedShareSummary[]): { text: string; tone: Tone }[] {
	const out: { text: string; tone: Tone }[] = [];
	for (const m of managed) {
		if (m.status === "pending") out.push({ text: `${m.name} deve ${formatBRL(m.dueCents)}`, tone: "owe" });
		else if (m.status === "refund") out.push({ text: `${m.name}: a receber de volta ${formatBRL(m.refundCents)}`, tone: "ok" });
	}
	return out;
}

/** Situação de uma despesa paga por quem você cuida: "Benjamim pagou · faltam 2 pagamentos". */
export function ownerViewStatus(payerName: string, v: OwnerView): { text: string; tone: Tone } {
	const pending = Math.max(0, v.pendingCount);
	const refunds = Math.max(0, v.refundCount);
	if (pending > 0) {
		const base = plural(pending, "falta 1 pagamento", `faltam ${pending} pagamentos`);
		const text = refunds > 0 ? `${base} e ${plural(refunds, "1 devolução", `${refunds} devoluções`)}` : base;
		return { text: `${payerName} pagou · ${text}`, tone: "wait" };
	}
	if (refunds > 0) return { text: `${payerName} pagou · devolver para ${plural(refunds, "1 pessoa", `${refunds} pessoas`)}`, tone: "owe" };
	return { text: `${payerName} pagou · tudo pago`, tone: "ok" };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Completa os campos "agora" quando o servidor ainda não manda: "agora" = o total, e nada vencido. */
export function nowBalanceOf(r: Record<string, unknown>, toReceiveCents: number, toPayCents: number): NowBalance {
	return {
		toReceiveNowCents: typeof r.toReceiveNowCents === "number" && Number.isFinite(r.toReceiveNowCents) ? r.toReceiveNowCents : toReceiveCents,
		toPayNowCents: typeof r.toPayNowCents === "number" && Number.isFinite(r.toPayNowCents) ? r.toPayNowCents : toPayCents,
		overdueToPayCents: num(r.overdueToPayCents),
	};
}

/** Aceita a resposta antiga de `/api/me/summary` (sem `managed`) e completa o que falta. */
export function normalizeMeSummary(raw: unknown): MeSummary {
	const r = (raw ?? {}) as Record<string, unknown>;
	const list = Array.isArray(r.managed) ? (r.managed as Record<string, unknown>[]) : [];
	return {
		toReceiveCents: num(r.toReceiveCents),
		toPayCents: num(r.toPayCents),
		...nowBalanceOf(r, num(r.toReceiveCents), num(r.toPayCents)),
		managed: list
			.filter((m) => m && typeof m.uid === "string" && typeof m.groupId === "string")
			.map((m) => ({
				uid: m.uid as string,
				name: typeof m.name === "string" ? m.name : "",
				groupId: m.groupId as string,
				groupName: typeof m.groupName === "string" ? m.groupName : "",
				toReceiveCents: num(m.toReceiveCents),
				toPayCents: num(m.toPayCents),
				...nowBalanceOf(m, num(m.toReceiveCents), num(m.toPayCents)),
			})),
	};
}
