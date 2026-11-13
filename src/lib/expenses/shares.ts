import { isDueNow, isPastDue, todayInSaoPaulo } from "./dates";
import { randomId } from "@/lib/random-id";
import type { AttachmentMeta } from "@/lib/storage/attachments";
import { splitEqually } from "./split";

/**
 * Modelo de cotas: cada cota guarda quanto a pessoa DEVE (`amountCents`) e quanto já PAGOU (`paidCents`).
 * Situação, valor em aberto e reembolso são sempre derivados daqui, nunca gravados.
 */
export type ShareStatus = "payer" | "pending" | "paid" | "refund";
/** "manual": o dono marcou como pago; "self": a própria pessoa avisou que pagou. */
export type ShareMethod = "manual" | "self";
/** Comprovante de pagamento da cota (mesmo formato de um anexo). `key` nunca sai da API. */
export type ShareReceipt = AttachmentMeta;
/** "Pagar tudo de uma vez": o pagamento fez parte de um lote com um só comprovante. */
export type ShareBatch = { id: string; totalCents: number; count: number };
/**
 * Devolução feita: quem pagou a despesa devolveu o que a pessoa pagou a mais. Guarda o quanto (`cents`), quando, quem
 * marcou, o comprovante DA DEVOLUÇÃO (outro documento, separado do `receipt` do pagamento original, que fica intacto)
 * e, se foi num "pagar tudo", o lote. Desfazer a devolução soma `cents` de volta ao `paidCents` e apaga este registro.
 */
export type ShareRefund = {
	cents: number;
	at: Date;
	markedBy: string;
	/** Marcada pelo administrador do grupo (e não por quem pagou). */
	byAdmin?: boolean;
	receipt?: ShareReceipt;
	batch?: ShareBatch;
};
/**
 * Pagamento parcial: um pedaço da parte pago antes da quitação. `paidCents` da cota continua sendo a verdade (soma dos
 * parciais mais o que a quitação pagou); `parts` só guarda o histórico (e os comprovantes) dos pagamentos que NÃO quitaram.
 * O pagamento que quita fica nos campos de topo da cota (`paidAt`, `markedBy`, `method`, `receipt`, `batch`).
 */
export type SharePart = {
	id: string;
	cents: number;
	/** Ausente quando o pagamento rebaixado vinha do modelo antigo, sem data (a tela mostra "data não registrada"). */
	at?: Date;
	markedBy: string;
	method: ShareMethod;
	/** Marcado pelo administrador do grupo (só com `method: "manual"`). */
	byAdmin?: boolean;
	receipt?: ShareReceipt;
	batch?: ShareBatch;
};
/** Quantos pagamentos parciais cabem numa cota (o documento não cresce sem fim). Quitar o que falta é sempre possível. */
export const MAX_PARTS = 20;

/**
 * INVARIANTE DOS PAGAMENTOS (vale depois de QUALQUER operação; `checkShareInvariant` a confere nos testes):
 *   total = paidCents + (refund?.cents ?? 0)           // o que a pessoa efetivamente pagou, devolvido ou não
 *   o pagamento de topo vale `topCentsOf(s)` = total - soma(parts) (>= 0) e existe SEMPRE que isso for > 0, com ou sem
 *   metadados (cotas do modelo antigo não têm data/quem/método); sem valor de topo não sobram metadados de topo.
 * Ou seja, `paidCents` nunca é um número solto: cada centavo pago está num parcial ou no pagamento de topo, e `parts` tem
 * só valores inteiros >= 1 e ids únicos. ORDEM = REGISTRO (nunca o relógio): parciais na ordem do array e o de topo por último;
 * `demoteTop` rebaixa o topo para o fim de `parts` antes de qualquer pagamento novo. Quando o registro de uma devolução é
 * descartado (a parte mudou), o que foi devolvido sai dos pagamentos do mais recente para o mais antigo (`dropRefund`), e o
 * comprovante só some junto com o pagamento que saiu inteiro. "Último pagamento" é sempre `latestPayment`.
 */
export type ExpenseShare = {
	uid: string;
	amountCents: number;
	paidCents: number;
	/** Pagamentos parciais ainda não quitados (do mais antigo ao mais novo). */
	parts?: SharePart[];
	/** Preenchidos só quando há pagamento que QUITOU a cota: quando, por quem foi marcado e como. */
	paidAt?: Date;
	markedBy?: string;
	/** Marcada como paga pelo administrador do grupo (não por quem pagou a conta). Só com `method: "manual"`. */
	markedByAdmin?: boolean;
	method?: ShareMethod;
	receipt?: ShareReceipt;
	/** Presente quando a cota foi paga num lote (vários pagamentos ao mesmo destinatário, um só comprovante). */
	batch?: ShareBatch;
	/** Presente quando a devolução do que a pessoa pagou a mais já foi feita. */
	refund?: ShareRefund;
	/** "Quero ajudar": a pessoa entrou na divisão por conta própria (pela ação de ajudar), não por escolha do dono. */
	helped?: boolean;
	helpedAt?: Date;
};

/**
 * Lê uma cota gravada no modelo antigo (`status`, sem `paidCents`): 'paid' vale paidCents = amountCents,
 * qualquer outro vale 0, e `status` some. Cotas já no modelo novo passam sem mudança.
 */
export function normalizeShare(s: ExpenseShare): ExpenseShare {
	const legacy = s as ExpenseShare & { status?: unknown };
	const base: ExpenseShare =
		typeof legacy.paidCents === "number"
			? s
			: (() => {
					const { status, ...rest } = legacy;
					return { ...rest, paidCents: status === "paid" ? legacy.amountCents : 0 };
				})();
	if (base.parts === undefined || partsAreClean(base.parts)) return base;
	// `parts` malformado (não é lista, ou tem elemento nulo/inválido): fica só o que é um parcial válido, sem gravar nada por isso.
	const { parts: _bad, ...rest } = base;
	void _bad;
	const kept = Array.isArray(base.parts) ? base.parts.flatMap((p) => cleanPart(p) ?? []) : [];
	return kept.length > 0 ? { ...rest, parts: kept } : rest;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Um parcial válido: id, valor inteiro >= 1, data, quem marcou e método; receipt/batch malformados são descartados. null = ignorar. */
function cleanPart(raw: unknown): SharePart | null {
	if (!isObj(raw)) return null;
	const { id, cents, markedBy, method, byAdmin, receipt, batch } = raw;
	const at = raw.at instanceof Date ? raw.at : typeof raw.at === "string" || typeof raw.at === "number" ? new Date(raw.at) : raw.at === undefined || raw.at === null ? undefined : null;
	if (typeof id !== "string" || id === "" || typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 1) return null;
	if (method !== "self" && method !== "manual") return null;
	if (at === null || (at && Number.isNaN(at.getTime()))) return null;
	const out: SharePart = { id, cents, markedBy: typeof markedBy === "string" ? markedBy : "", method };
	// Época zero (1970) é o "sem data" que uma versão anterior gravou: lê como sem data (sem gravar nada por isso).
	if (at && at.getTime() !== 0) out.at = at;
	if (byAdmin === true) out.byAdmin = true;
	if (isObj(receipt) && typeof receipt.key === "string") out.receipt = receipt as unknown as ShareReceipt;
	if (isObj(batch) && typeof batch.id === "string") out.batch = batch as unknown as ShareBatch;
	return out;
}

/** `parts` já é uma lista só de parciais válidos (o caso normal: nada a copiar). */
function partsAreClean(parts: unknown): boolean {
	return Array.isArray(parts) && parts.length > 0 && parts.every(isCleanShape);
}
function isCleanShape(p: unknown): boolean {
	if (!isObj(p)) return false;
	const c = cleanPart(p);
	return c !== null && (p.at === undefined || (p.at instanceof Date && p.at.getTime() !== 0)) && (p.receipt === undefined || (isObj(p.receipt) && typeof p.receipt.key === "string")) && (p.batch === undefined || (isObj(p.batch) && typeof p.batch.id === "string")) && typeof p.markedBy === "string";
}

export const normalizeShares = (shares: ExpenseShare[]): ExpenseShare[] =>
	shares.some((s) => typeof s.paidCents !== "number" || (s.parts !== undefined && !partsAreClean(s.parts))) ? shares.map(normalizeShare) : shares;

/** Quanto a pessoa ainda deve a quem pagou. A cota de quem pagou nunca deve nada. */
export function dueCents(s: ExpenseShare, paidBy: string): number {
	return s.uid === paidBy ? 0 : Math.max(0, s.amountCents - s.paidCents);
}

/** Quanto quem pagou deve devolver à pessoa (ela pagou mais do que a cota atual). */
export function refundCents(s: ExpenseShare, paidBy: string): number {
	return s.uid === paidBy ? 0 : Math.max(0, s.paidCents - s.amountCents);
}

export function shareStatus(s: ExpenseShare, paidBy: string): ShareStatus {
	if (s.uid === paidBy) return "payer";
	if (s.paidCents < s.amountCents) return "pending";
	if (s.paidCents > s.amountCents) return "refund";
	return "paid"; // paidCents === amountCents (cota 0 sem pagamento não deveria existir)
}

export const participates = (s: ExpenseShare) => s.amountCents > 0;

/** Quem divide a despesa agora: cotas com valor > 0 (inclui quem pagou, se participa). */
export function participantUidsOf(shares: ExpenseShare[]): string[] {
	return shares.filter(participates).map((s) => s.uid);
}

/**
 * Alguém além de quem pagou já registrou pagamento? Então a despesa não pode ser apagada.
 * Cota com devolução registrada ou com comprovante também conta (mesmo que o pago já tenha voltado a 0): apagar levaria
 * junto o histórico e os comprovantes.
 */
export function hasPayments(e: { paidBy: string; shares: ExpenseShare[] }): boolean {
	return normalizeShares(e.shares).some((s) => s.uid !== e.paidBy && (s.paidCents > 0 || s.refund !== undefined || s.receipt !== undefined || (s.parts?.length ?? 0) > 0));
}

/**
 * Refaz a divisão do TOTAL igualmente entre `participantUids`, preservando o que cada um já pagou.
 * Quem saiu da divisão só continua na despesa (cota 0) se já tinha pagado — para ser reembolsado.
 * Lança o erro de `splitEqually` se o valor for pequeno demais.
 */
export function recalcShares(
	prev: ExpenseShare[],
	paidBy: string,
	amountCents: number,
	participantUids: string[],
): ExpenseShare[] {
	const split = splitEqually(amountCents, participantUids, paidBy);
	const before = new Map(prev.map((s) => [s.uid, s]));
	const next: ExpenseShare[] = split.map(({ uid, amountCents: cents }) => {
		if (uid === paidBy) return { uid, amountCents: cents, paidCents: 0 };
		const old = before.get(uid);
		if (!old) return { uid, amountCents: cents, paidCents: 0 };
		// Quem saiu, já teve tudo devolvido (cota 0, nada pago) e volta: começa limpo, sem a data, o método nem o comprovante antigos.
		if (old.amountCents === 0 && old.paidCents === 0) return { uid, amountCents: cents, paidCents: 0 };
		// Se a cota muda, o registro de uma devolução antiga deixa de valer (não dá para desfazê-la sobre outro valor):
		// o que foi devolvido sai dos pagamentos, do mais recente para o mais antigo (ver `dropRefund`).
		return { ...(cents === old.amountCents ? old : dropRefund(old)), uid, amountCents: cents };
	});
	const staying = new Set(participantUids);
	for (const old of prev) {
		if (old.uid === paidBy || staying.has(old.uid)) continue;
		// Linha de quem saiu e já teve tudo devolvido (devolução ou comprovante registrados, nada mais a acertar): fica como está.
		if (old.paidCents <= 0) {
			if (old.amountCents === 0 && (old.refund || old.receipt)) next.push(old);
			continue;
		}
		// A cota vira 0: o registro de uma devolução antiga deixa de valer (o que foi pago volta a ser "a receber de volta" por inteiro).
		next.push({ ...dropRefund(old), amountCents: 0 });
	}
	return next;
}

/** Quem ajudou e ainda divide a despesa (a marca some da contagem quando a cota fica só para reembolso). */
export const isHelper = (s: ExpenseShare) => s.helped === true && s.amountCents > 0;

/**
 * Entrada de `helper` na divisão ("Quero ajudar"): divide igualmente entre quem já divide + `helper`
 * (regras de `recalcShares`) e marca a cota nova. Lança o erro de `splitEqually` se o valor for pequeno demais.
 */
export function addHelper(
	prev: ExpenseShare[],
	paidBy: string,
	amountCents: number,
	helper: string,
	now: Date,
): ExpenseShare[] {
	const next = recalcShares(prev, paidBy, amountCents, [...participantUidsOf(prev), helper]);
	return next.map((s) => (s.uid === helper ? { ...s, helped: true, helpedAt: now } : s));
}

export type ShareChange = { shares: ExpenseShare[]; changed: boolean };

const TOP_FIELDS = ["paidAt", "markedBy", "markedByAdmin", "method", "receipt", "batch"] as const;

/** Soma dos pagamentos parciais registrados. */
export const partsPaidCents = (s: ExpenseShare): number => (s.parts ?? []).reduce((t, p) => t + p.cents, 0);

/**
 * Valor do pagamento de topo (o que quitou), derivado da invariante: total - soma dos parciais (nunca negativo).
 * É ESTRUTURAL: existe pagamento de topo sempre que isso é > 0, com ou sem metadados (cotas do modelo antigo não têm data, quem
 * marcou nem método: aparecem como "pago", sem esses dados).
 */
export const topCentsOf = (s: ExpenseShare): number => Math.max(0, s.paidCents + (s.refund?.cents ?? 0) - partsPaidCents(s));

/** A cota tem pagamento de topo? (estrutural: ver `topCentsOf`) */
export const hasTopPayment = (s: ExpenseShare): boolean => topCentsOf(s) > 0;

/** Id novo e único de parcial (128 bits, hexadecimal; casa com a validação do `pid` na rota do comprovante). */
export const newPartId = randomId;

function stripTop(s: ExpenseShare): ExpenseShare {
	const out = { ...s };
	for (const k of TOP_FIELDS) delete out[k];
	return out;
}

/** `parts` vazio some do documento. */
function withParts(s: ExpenseShare, parts: SharePart[]): ExpenseShare {
	const { parts: _old, ...rest } = s;
	void _old;
	return parts.length > 0 ? { ...rest, parts } : rest;
}

/** Um pagamento da cota, do topo ou parcial (com o valor e os dados de quem marcou, quando se sabe). */
export type PaymentEntry = {
	kind: "top" | "part";
	/** Posição em `parts` (só `kind: "part"`). */
	index: number;
	cents: number;
	/** Só para exibição: a ordem dos pagamentos NUNCA depende da data. */
	at?: Date;
	markedBy: string;
	/** Ausente só no pagamento de topo de cota do modelo antigo. */
	method?: ShareMethod;
	byAdmin: boolean;
	receipt?: ShareReceipt;
	batch?: ShareBatch;
};

/**
 * Todos os pagamentos da cota NA ORDEM DE REGISTRO: parciais na ordem do array e o de topo por último (ele quitou depois de todos
 * os parciais; `demoteTop` garante isso quando uma parte que cresceu ganha novos pagamentos). Datas servem só para exibição:
 * o relógio (upload demorado, servidores com horas diferentes) nunca muda qual é o último.
 */
export function paymentEntries(s: ExpenseShare): PaymentEntry[] {
	const out: PaymentEntry[] = (s.parts ?? []).map((p, index) => ({
		kind: "part",
		index,
		cents: p.cents,
		at: p.at,
		markedBy: p.markedBy,
		method: p.method,
		byAdmin: p.byAdmin === true,
		receipt: p.receipt,
		batch: p.batch,
	}));
	const top = topCentsOf(s);
	if (top > 0) {
		out.push({ kind: "top", index: -1, cents: top, at: s.paidAt, markedBy: s.markedBy ?? "", method: s.method, byAdmin: s.method === "manual" && s.markedByAdmin === true, receipt: s.receipt, batch: s.batch });
	}
	return out;
}

/**
 * O ÚLTIMO pagamento (o único conceito de "último"): o de topo, se existe; senão o último parcial do array. É o que `undoShare`
 * desfaz, o que a tela anuncia (`last`), o que `canUndoOwnPart` examina e o que a troca de comprovante pode alterar.
 */
export function latestPayment(s: ExpenseShare): PaymentEntry | undefined {
	const all = paymentEntries(s);
	return all[all.length - 1];
}

/**
 * Cota com pagamento de topo, mas ainda em aberto (a parte cresceu depois de paga, ou é do modelo antigo): antes de entrar outro
 * pagamento, o de topo vira o ÚLTIMO parcial (id novo e único; histórico e comprovante ficam). Assim o novo pagamento é sempre o mais
 * recente e os campos de topo só valem para o pagamento que QUITA. Não impõe o teto de parciais (quem decide é `addPayment`).
 */
function demoteTop(s: ExpenseShare): ExpenseShare {
	const cents = topCentsOf(s);
	const parts = s.parts ?? [];
	const base = stripTop(s);
	if (cents <= 0) return withParts(base, parts);
	// Sem data, quem marcou ou método (modelo antigo): o valor continua pago, com o que se sabe.
	const part: SharePart = { id: newPartId(), cents, markedBy: s.markedBy ?? "", method: s.method ?? "manual" };
	if (s.paidAt) part.at = s.paidAt;
	if (s.method === "manual" && s.markedByAdmin) part.byAdmin = true;
	if (s.receipt) part.receipt = s.receipt;
	if (s.batch) part.batch = s.batch;
	return withParts(base, [...parts, part]);
}

/**
 * Descarta o registro de uma devolução porque a parte mudou: o que tinha sido devolvido sai dos pagamentos, do mais recente
 * para o mais antigo (mesma ordem de `latestPayment`: topo, depois os parciais de trás para frente). O pagamento só some inteiro
 * se foi todo devolvido; senão fica com o valor menor e o comprovante. `paidCents` não muda.
 */
function dropRefund(s: ExpenseShare): ExpenseShare {
	const refund = s.refund;
	if (!refund) return s;
	const { refund: _gone, ...rest } = s;
	void _gone;
	let left = refund.cents;
	const newestFirst = paymentEntries(s).reverse();
	const parts = [...(s.parts ?? [])];
	const gone = new Set<number>();
	let topGone = false;
	for (const e of newestFirst) {
		if (left <= 0) break;
		if (e.cents <= left) {
			left -= e.cents;
			if (e.kind === "top") topGone = true;
			else gone.add(e.index);
		} else {
			if (e.kind === "part") parts[e.index] = { ...parts[e.index], cents: e.cents - left };
			left = 0; // o de topo é derivado: reduz sozinho quando o refund sai da conta
		}
	}
	const kept = parts.filter((_, i) => !gone.has(i));
	const out = withParts(rest, kept);
	// Sem valor de topo não sobram metadados de topo.
	return topGone || topCentsOf(out) === 0 ? stripTop(out) : out;
}

/**
 * A própria pessoa (ou quem age por ela) pode desfazer o último pagamento: só quando ele é um parcial que ela mesma avisou
 * (`method: "self"`). Quem pagou a despesa e o administrador usam as regras de sempre.
 */
export function canUndoOwnPart(s: ExpenseShare, actorUid: string): boolean {
	if (s.refund) return false;
	const last = latestPayment(s);
	return !!last && last.kind === "part" && last.method === "self" && last.markedBy === actorUid;
}

/** Confere a invariante dos pagamentos (só para testes): devolve os problemas encontrados (vazio = tudo certo). */
export function checkShareInvariant(s: ExpenseShare): string[] {
	const bad: string[] = [];
	if (!Number.isSafeInteger(s.paidCents) || s.paidCents < 0) bad.push(`paidCents inválido: ${s.paidCents}`);
	if (!Number.isSafeInteger(s.amountCents) || s.amountCents < 0) bad.push(`amountCents inválido: ${s.amountCents}`);
	const ids = new Set<string>();
	for (const p of s.parts ?? []) {
		if (!Number.isSafeInteger(p.cents) || p.cents <= 0) bad.push(`parcial com cents ${p.cents}`);
		if (ids.has(p.id)) bad.push(`id de parcial repetido: ${p.id}`);
		ids.add(p.id);
	}
	if (s.parts && s.parts.length === 0) bad.push("parts vazio deveria sumir");
	const total = s.paidCents + (s.refund?.cents ?? 0);
	const sum = partsPaidCents(s);
	if (total < sum) bad.push(`soma dos parciais ${sum} maior que o total pago ${total}`);
	const hasMeta = TOP_FIELDS.some((k) => s[k] !== undefined);
	if (total === sum && hasMeta) bad.push("metadados de pagamento de topo sem valor de topo");
	return bad;
}

export type PartError = "invalid" | "too_much" | "limit" | "stale";

/**
 * Registra um pagamento de `cents` na parte de `targetUid` (1 até o que falta). Igual ao que falta = quitação de sempre
 * (`payShare` para "self", `settleShare` para "manual"); menor = pagamento parcial, que a deixa em aberto. Valor que não é
 * inteiro, é menor que 1 ou passa do que falta é recusado (parcial nunca gera devolução). null: alvo é quem pagou ou
 * não tem parte a pagar. Pura e reutilizável (um valor avulso numa compra parcelada vai usar a mesma regra).
 */
export function addPayment(
	shares: ExpenseShare[],
	paidBy: string,
	targetUid: string,
	cents: number,
	now: Date,
	actorUid: string,
	o: { method: ShareMethod; asAdmin?: boolean; receipt?: ShareReceipt; partId: string; /** Quanto a tela mostrava como já pago: se mudou, recusa ("stale"). */ expectedPaidCents?: number },
): ShareChange | { error: PartError } | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy || shares[i].amountCents <= 0) return null;
	const s = shares[i];
	if (!Number.isSafeInteger(cents) || cents < 1) return { error: "invalid" };
	if (o.expectedPaidCents !== undefined && o.expectedPaidCents !== s.paidCents) return { error: "stale" };
	const due = s.amountCents - s.paidCents;
	if (cents > due) return { error: "too_much" };
	if (cents === due) {
		return o.method === "self" ? payShare(shares, paidBy, targetUid, now, actorUid, o.receipt) : settleShare(shares, paidBy, targetUid, now, actorUid, o.asAdmin === true);
	}
	// Teto: vale só para NOVOS parciais (contado depois de rebaixar o topo). Quitar o que falta é sempre possível, mesmo acima do
	// teto (o rebaixamento do topo pode deixar a parte com mais de MAX_PARTS; ela só não aceita outro parcial até desfazer alguns).
	const base = demoteTop(s);
	const parts = base.parts ?? [];
	if (parts.length >= MAX_PARTS) return { error: "limit" };
	const part: SharePart = { id: o.partId, cents, at: now, markedBy: actorUid, method: o.method };
	if (o.method === "manual" && o.asAdmin) part.byAdmin = true;
	if (o.receipt) part.receipt = o.receipt;
	return { shares: shares.map((x, j) => (j === i ? { ...base, parts: [...parts, part], paidCents: s.paidCents + cents } : x)), changed: true };
}

/**
 * O pagamento da própria pessoa (o "Já paguei"): sem `amountCents` quita o que falta (como sempre); com `amountCents` paga só esse
 * valor e EXIGE `expectedPaidCents` (quanto a tela mostrava como já pago), para que toque duplo, resposta perdida ou tela
 * desatualizada nunca paguem duas vezes. Uma só função, usada na conferência prévia e dentro de `mutateShares`.
 */
export function selfPayChange(
	shares: ExpenseShare[],
	paidBy: string,
	targetUid: string,
	now: Date,
	actorUid: string,
	o: { amountCents?: number; expectedPaidCents?: number; receipt?: ShareReceipt; partId: string },
): ShareChange | { error: PartError } | null {
	if (o.amountCents === undefined) return payShare(shares, paidBy, targetUid, now, actorUid, o.receipt);
	if (o.expectedPaidCents === undefined) return { error: "invalid" };
	return addPayment(shares, paidBy, targetUid, o.amountCents, now, actorUid, { method: "self", receipt: o.receipt, partId: o.partId, expectedPaidCents: o.expectedPaidCents });
}

/** Dono quita a cota (pendente recebida ou reembolso devolvido). null: alvo é o dono ou não tem cota. */
export function settleShare(
	shares: ExpenseShare[],
	paidBy: string,
	targetUid: string,
	now: Date,
	actorUid: string,
	asAdmin = false,
	refundReceipt?: ShareReceipt,
	batch?: ShareBatch,
): ShareChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy) return null;
	const s = shares[i];
	if (s.paidCents === s.amountCents) return { shares, changed: false }; // idempotente: preserva paidAt
	if (s.paidCents > s.amountCents) {
		// Devolução: a pessoa pagou a mais. O pagamento original (paidAt, method, receipt) fica; só entra o registro da devolução.
		const refund: ShareRefund = { cents: s.paidCents - s.amountCents, at: now, markedBy: actorUid };
		if (asAdmin) refund.byAdmin = true;
		if (refundReceipt) refund.receipt = { ...refundReceipt };
		if (batch) refund.batch = { ...batch };
		return { shares: shares.map((x, j) => (j === i ? { ...s, paidCents: s.amountCents, refund } : x)), changed: true };
	}
	const settled: ExpenseShare = { ...demoteTop(s), paidCents: s.amountCents, paidAt: now, markedBy: actorUid, method: "manual" };
	if (asAdmin) settled.markedByAdmin = true;
	return { shares: shares.map((x, j) => (j === i ? settled : x)), changed: true };
}

/**
 * Desfaz o ÚLTIMO pagamento (`latestPayment`: o de topo, se existe, senão o último parcial): se é o de topo, tira os metadados de
 * topo e o valor dele; se é um parcial, tira esse parcial. Os outros pagamentos e comprovantes ficam. Cota 0 (não participa) sem
 * mais nada pago some. Uma devolução registrada é desfeita primeiro (o pagamento original não muda).
 */
export function undoShare(shares: ExpenseShare[], paidBy: string, targetUid: string): ShareChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy) return null;
	const s = shares[i];
	if (s.refund) {
		// Desfaz a devolução: a pessoa volta a ter o que pagou a mais para receber (o pagamento original não muda).
		const { refund, ...rest } = s;
		return { shares: shares.map((x, j) => (j === i ? { ...rest, paidCents: s.paidCents + refund.cents } : x)), changed: true };
	}
	const latest = latestPayment(s);
	if (!latest) return { shares, changed: false };
	const next: ExpenseShare =
		latest.kind === "top"
			? { ...stripTop(s), paidCents: Math.max(0, s.paidCents - latest.cents) }
			: withParts({ ...s, paidCents: Math.max(0, s.paidCents - latest.cents) }, (s.parts ?? []).filter((_, k) => k !== latest.index));
	if (s.amountCents === 0 && next.paidCents === 0 && !next.parts) return { shares: shares.filter((_, j) => j !== i), changed: true };
	return { shares: shares.map((x, j) => (j === i ? next : x)), changed: true };
}

/**
 * `undoShare` com conferência: o pedido de desfazer traz `expectedPaidCents` (quanto a tela mostrava como já pago). Se diverge do
 * `paidCents` atual, recusa ("stale") sem desfazer. Sem o campo (cliente antigo) só vale quando a parte não tem parciais: com
 * parciais a tela pode estar desfazendo um pagamento diferente do que anuncia, então também recusa.
 */
export function undoShareIfCurrent(shares: ExpenseShare[], paidBy: string, targetUid: string, expectedPaidCents?: number): ShareChange | { error: "stale" } | null {
	const s = shares.find((x) => x.uid === targetUid);
	if (s && targetUid !== paidBy) {
		if (expectedPaidCents !== undefined ? expectedPaidCents !== s.paidCents : (s.parts?.length ?? 0) > 0) return { error: "stale" };
	}
	return undoShare(shares, paidBy, targetUid);
}

/** Quem deve avisa que pagou (com comprovante opcional). null: alvo é quem pagou, não tem cota ou ela é só reembolso. */
export type SelfPayChange = ShareChange;
export function payShare(
	shares: ExpenseShare[],
	paidBy: string,
	targetUid: string,
	now: Date,
	actorUid: string,
	receipt?: ShareReceipt,
): SelfPayChange | null {
	const i = shares.findIndex((s) => s.uid === targetUid);
	if (i < 0 || targetUid === paidBy || shares[i].amountCents <= 0) return null;
	const s = shares[i];
	const put = (next: ExpenseShare): ShareChange => ({ shares: shares.map((x, j) => (j === i ? next : x)), changed: true });
	if (s.paidCents < s.amountCents) {
		const paid: ExpenseShare = { ...demoteTop(s), paidCents: s.amountCents, paidAt: now, markedBy: actorUid, method: "self" };
		if (receipt) paid.receipt = receipt;
		return put(paid);
	}
	// Já quitada: só troca/anexa o comprovante do último pagamento (mantém paidAt, markedBy e method). Sem arquivo não muda nada.
	// O comprovante novo vale só para esta cota: ela sai do lote (as outras do lote mantêm o comprovante do lote).
	if (s.paidCents === s.amountCents && receipt) {
		const latest = latestPayment(s);
		// Só troca o comprovante do último pagamento quando ele foi um aviso da própria pessoa ("self"), ou quando ainda não tem
		// comprovante (anexar o que faltava). Nunca substitui (e apaga) o comprovante de um pagamento marcado por outra pessoa.
		if (!latest || (latest.method !== "self" && latest.receipt)) return { shares, changed: false };
		if (latest.kind === "part") {
			// O pagamento mais recente é um parcial (a parte mudou depois): o comprovante novo vai para ele.
			const parts = s.parts!.map((p, k) => {
				if (k !== latest.index) return p;
				const { batch: _b, ...np } = p;
				void _b;
				return { ...np, receipt };
			});
			return put({ ...s, parts });
		}
		const moved: ExpenseShare = { ...s, receipt };
		delete moved.batch;
		return put(moved);
	}
	return { shares, changed: false };
}

export type BatchOutcome =
	| { uid: string; result: "paid"; amountCents: number }
	| { uid: string; result: "already_paid" | "not_found" };

/**
 * Quita várias cotas de uma mesma despesa de uma vez (`method: "self"`), todas com o mesmo comprovante e o mesmo lote.
 * Cota que não existe (ou é a de quem pagou / só reembolso) vira `not_found`; a que já está quitada, `already_paid`;
 * as demais seguem normalmente. `amountCents` = o que faltava pagar na cota.
 */
export function payShares(
	shares: ExpenseShare[],
	paidBy: string,
	targetUids: string[],
	now: Date,
	actorUid: string,
	receipt: ShareReceipt | undefined,
	batch: ShareBatch,
): { shares: ExpenseShare[]; changed: boolean; outcomes: BatchOutcome[] } {
	const targets = new Set(targetUids);
	const outcomes: BatchOutcome[] = [];
	let changed = false;
	const next = shares.map((s) => {
		if (!targets.has(s.uid)) return s;
		if (s.uid === paidBy || s.amountCents <= 0) {
			outcomes.push({ uid: s.uid, result: "not_found" });
			return s;
		}
		if (s.paidCents >= s.amountCents) {
			outcomes.push({ uid: s.uid, result: "already_paid" });
			return s;
		}
		outcomes.push({ uid: s.uid, result: "paid", amountCents: s.amountCents - s.paidCents });
		changed = true;
		const paid: ExpenseShare = { ...demoteTop(s), paidCents: s.amountCents, paidAt: now, markedBy: actorUid, method: "self", batch: { ...batch } };
		if (receipt) paid.receipt = { ...receipt };
		return paid;
	});
	for (const uid of targets) if (!outcomes.some((o) => o.uid === uid)) outcomes.push({ uid, result: "not_found" });
	return { shares: changed ? next : shares, changed, outcomes };
}

export type RefundOutcome = { uid: string; result: "refunded"; amountCents: number } | { uid: string; result: "already_refunded" | "not_found" };

/**
 * Devolve de uma vez a várias pessoas (todas desta despesa), com o mesmo comprovante e o mesmo lote.
 * Cota sem devolução a fazer: `already_refunded` se não deve nada, `not_found` se não existe ou é a de quem pagou.
 */
export function refundShares(
	shares: ExpenseShare[],
	paidBy: string,
	targetUids: string[],
	now: Date,
	actorUid: string,
	receipt: ShareReceipt | undefined,
	batch: ShareBatch,
): { shares: ExpenseShare[]; changed: boolean; outcomes: RefundOutcome[] } {
	const targets = new Set(targetUids);
	const outcomes: RefundOutcome[] = [];
	let changed = false;
	const next = shares.map((s) => {
		if (!targets.has(s.uid)) return s;
		if (s.uid === paidBy) {
			outcomes.push({ uid: s.uid, result: "not_found" });
			return s;
		}
		if (s.paidCents <= s.amountCents) {
			outcomes.push({ uid: s.uid, result: "already_refunded" });
			return s;
		}
		outcomes.push({ uid: s.uid, result: "refunded", amountCents: s.paidCents - s.amountCents });
		changed = true;
		return settleShare([s], paidBy, s.uid, now, actorUid, false, receipt, batch)!.shares[0];
	});
	for (const uid of targets) if (!outcomes.some((o) => o.uid === uid)) outcomes.push({ uid, result: "not_found" });
	return { shares: changed ? next : shares, changed, outcomes };
}

/** Chaves de comprovante que existiam em `before` e não existem mais em `after` (para apagar do armazenamento). */
export const receiptKeysOfShare = (s: ExpenseShare): string[] => [
	...(s.receipt ? [s.receipt.key] : []),
	...(s.refund?.receipt ? [s.refund.receipt.key] : []),
	...(s.parts ?? []).flatMap((p) => (p.receipt ? [p.receipt.key] : [])),
];

export function droppedReceiptKeys(before: ExpenseShare[], after: ExpenseShare[]): string[] {
	const keep = new Set(after.flatMap(receiptKeysOfShare));
	return before.flatMap(receiptKeysOfShare).filter((k) => !keep.has(k));
}

/** Ordem de exibição: dono, depois participantes por nome, depois linhas de reembolso (não participam). */
export function orderShares<T extends { uid: string; amountCents: number }>(
	shares: T[],
	paidBy: string,
	nameOf: (uid: string) => string,
): T[] {
	const rank = (s: T) => (s.uid === paidBy ? 0 : s.amountCents > 0 ? 1 : 2);
	return [...shares].sort(
		(a, b) => rank(a) - rank(b) || nameOf(a.uid).localeCompare(nameOf(b.uid), "pt-BR") || a.uid.localeCompare(b.uid),
	);
}

export type Balance = {
	/** Tudo o que está em aberto. */
	toReceiveCents: number;
	toPayCents: number;
	/** A parte de cima cuja despesa não tem vencimento ou vence até o fim do mês atual (reembolsos sempre contam). */
	toReceiveNowCents: number;
	toPayNowCents: number;
	/** O que a pessoa deve em despesas com vencimento antes de hoje. */
	overdueToPayCents: number;
};

/**
 * Referência em JS da conta de saldos (a agregação do MongoDB faz o mesmo):
 * a pagar = o que `uid` deve + reembolsos que `uid` deve como dono;
 * a receber = o que devem a `uid` como dono + reembolsos que outros donos devem a `uid`.
 * "Agora" = sem `dueDate` ou `dueDate` até o último dia do mês de hoje (São Paulo); reembolso sempre é "agora".
 */
export function balanceOf(
	expenses: { paidBy: string; shares: ExpenseShare[]; dueDate?: string | null }[],
	uid: string,
	now: Date = new Date(),
): Balance {
	const today = todayInSaoPaulo(now);
	const b: Balance = { toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 };
	for (const e of expenses) {
		const dueNow = isDueNow(e.dueDate, today);
		const late = isPastDue(e.dueDate, today);
		for (const s of normalizeShares(e.shares)) {
			if (s.uid === e.paidBy) continue;
			const due = dueCents(s, e.paidBy);
			const refund = refundCents(s, e.paidBy);
			if (e.paidBy === uid) {
				b.toReceiveCents += due;
				b.toReceiveNowCents += dueNow ? due : 0;
				b.toPayCents += refund;
				b.toPayNowCents += refund;
			} else if (s.uid === uid) {
				b.toPayCents += due;
				b.toPayNowCents += dueNow ? due : 0;
				b.overdueToPayCents += late ? due : 0;
				b.toReceiveCents += refund;
				b.toReceiveNowCents += refund;
			}
		}
	}
	return b;
}
