import { jsonError } from "@/lib/api/http";

/** Teto de sanidade para valores em centavos vindos do cliente (R$ 10 milhões); o limite real é o que falta pagar na parte. */
const MAX_CENTS = 1_000_000_000;

/** Lê um inteiro de centavos (número ou texto só de dígitos) com mínimo `min`; qualquer outra coisa (inclusive vazio/nulo) é inválida. */
function parseCents(raw: unknown, min: number): number | null {
	const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
	return Number.isSafeInteger(n) && n >= min && n <= MAX_CENTS ? n : null;
}

export type PartialRequest = { ok: true; amountCents?: number; expectedPaidCents?: number } | { ok: false };

/**
 * Lê `amountCents` (>= 1) e `expectedPaidCents` (>= 0) de um pedido. O que importa é a PRESENÇA da chave, não o valor:
 * - "pay" ("Já paguei" / "Recebi"): sem nenhuma das duas chaves é o pedido antigo ("quitar o que falta"). Com qualquer uma, as DUAS
 *   precisam estar presentes e válidas; chave presente mas vazia, nula ou inválida NUNCA vira quitação total (422).
 * - "undo" (desfazer): `amountCents` não faz sentido; `expectedPaidCents` é opcional (cliente antigo), mas se veio precisa ser válido.
 */
export function readPartialRequest(
	fields: { amountCents?: unknown; expectedPaidCents?: unknown },
	present: { amountCents: boolean; expectedPaidCents: boolean },
	mode: "pay" | "undo",
): PartialRequest {
	if (mode === "undo") {
		if (present.amountCents) return { ok: false };
		if (!present.expectedPaidCents) return { ok: true };
		const e = parseCents(fields.expectedPaidCents, 0);
		return e === null ? { ok: false } : { ok: true, expectedPaidCents: e };
	}
	if (!present.amountCents && !present.expectedPaidCents) return { ok: true };
	const a = present.amountCents ? parseCents(fields.amountCents, 1) : null;
	const e = present.expectedPaidCents ? parseCents(fields.expectedPaidCents, 0) : null;
	return a === null || e === null ? { ok: false } : { ok: true, amountCents: a, expectedPaidCents: e };
}

export type AdvanceRequest = { ok: true; shareUid: string; mode: "self" | "manual"; amountCents: number; expectedDueCents: number; recipientId: string } | { ok: false; field: "shareUid" | "mode" | "amountCents" | "expectedDueCents" | "recipientId" };

/**
 * Lê um pedido de "adiantar parcelas": `shareUid` (texto 1 a 200), `mode` ("self" = paguei, "manual" = recebi), `amountCents` (>= 1)
 * `expectedDueCents` (>= 0, o total que a tela mostrava faltando) e `recipientId` (quem recebe, como a tela viu). As cinco chaves são obrigatórias; vazio, nulo, decimal,
 * negativo, texto com sinal/espaço/notação científica ou acima do teto são recusados (nunca viram outro valor).
 */
export function readAdvanceRequest(fields: { shareUid?: unknown; mode?: unknown; amountCents?: unknown; expectedDueCents?: unknown; recipientId?: unknown }): AdvanceRequest {
	const { shareUid, mode } = fields;
	if (typeof shareUid !== "string" || shareUid.length < 1 || shareUid.length > 200) return { ok: false, field: "shareUid" };
	if (mode !== "self" && mode !== "manual") return { ok: false, field: "mode" };
	const amountCents = parseCents(fields.amountCents, 1);
	if (amountCents === null) return { ok: false, field: "amountCents" };
	const expectedDueCents = parseCents(fields.expectedDueCents, 0);
	if (expectedDueCents === null) return { ok: false, field: "expectedDueCents" };
	// Quem recebe, como a tela o viu (mesmo padrão do Pagar tudo): se a chave Pix ou o destinatário mudou, o servidor recusa.
	const { recipientId } = fields;
	if (typeof recipientId !== "string" || !/^r_[0-9a-f]{24}$/.test(recipientId)) return { ok: false, field: "recipientId" };
	return { ok: true, shareUid, mode, amountCents, expectedDueCents, recipientId };
}

/** Presença de uma chave num objeto JSON (`null` e vazio contam como presentes). */
export const hasKey = (obj: unknown, key: string): boolean => !!obj && typeof obj === "object" && Object.hasOwn(obj, key);

export const INVALID_AMOUNT = "Digite um valor válido.";
export const INVALID_REQUEST = "Pedido inválido.";
export const TOO_MUCH = "Esse valor é maior do que falta pagar. Atualize e tente de novo.";
export const STALE = "Esta conta mudou. Atualize e confira antes de pagar de novo.";
export const STALE_UNDO = "Esta conta mudou. Atualize e confira antes de desfazer.";
export const STALE_BATCH = "Os valores mudaram. Atualize e confira antes de pagar.";
export const TOO_MANY_PARTS = "Essa parte já teve pagamentos demais. Pague o que falta de uma vez.";

/** Resposta de erro para um valor recusado pelo repositório. */
export function amountRejectionResponse(status: "invalid_amount" | "too_much" | "too_many_parts" | "stale" | "stale_undo"): Response {
	if (status === "stale") return jsonError(STALE, 409, "amountCents");
	if (status === "stale_undo") return jsonError(STALE_UNDO, 409);
	if (status === "invalid_amount") return jsonError(INVALID_AMOUNT, 422, "amountCents");
	if (status === "too_much") return jsonError(TOO_MUCH, 409, "amountCents");
	return jsonError(TOO_MANY_PARTS, 422, "amountCents");
}
