import type { Db } from "mongodb";
import { describeError } from "@/lib/api/http";
import {
	directory,
	expensesCollection,
	fillMissingPix,
	findExpense,
	findMemberGroup,
	getExpenseDetail,
	loadPeople,
	mutateShares,
	releaseReceipts,
	type ExpenseDetail,
	type ExpenseDoc,
} from "@/lib/expenses/repo";
import { dueCents, normalizeShares } from "@/lib/expenses/shares";
import type { SniffedFile } from "@/lib/expenses/validation";
import { actsFor, expenseRole } from "@/lib/groups/helpers";
import { batchReceiptSpec } from "@/lib/notifications/facts";
import type { AdvanceFact } from "@/lib/notifications/types";
import { putBatchReceipt, randomId, type AttachmentMeta, type AttachmentStore } from "@/lib/storage/attachments";
import { applyAdvanceSlice, distributeAdvance, totalDue, undoAdvanceSlice, type AdvanceItem, type AdvanceSummaryItem } from "./advance";
import { recipientIdFromKey, recipientKey } from "./payables";

/** Quantas parcelas são gravadas (e desfeitas) ao mesmo tempo. Pequeno: o banco gratuito não precisa de mais, e 48 parcelas levam poucas rodadas. */
export const WRITE_CONCURRENCY = 4;

/** Uma parcela da compra em que a pessoa ainda deve algo. */
export type AdvancePlanItem = { id: string; number: number; dueDate: string | null; dueCents: number };
export type AdvancePlan = {
	shareUid: string;
	/** Número da parcela que a tela tem aberta (o adiantamento NÃO começa nela: começa na mais antiga em aberto). */
	currentNumber: number;
	/** O que falta na parcela aberta na tela, se ela está neste adiantamento (senão 0). */
	thisDueCents: number;
	/** O que falta nas parcelas deste adiantamento: é o `expectedDueCents` do pedido. */
	totalDueCents: number;
	/** Parcelas deste adiantamento, da mais antiga para a mais nova: só as que vão para o MESMO destinatário (o primeiro). */
	items: AdvancePlanItem[];
	/** Quem recebe estas parcelas. `pix` só vem ao pagar (`mode: "self"`) e só para membros do grupo; null = sem chave Pix cadastrada. */
	recipient: { id: string; name: string; pix: { type: string; key: string; payeeName: string } | null } | null;
	/** Há parcelas em aberto mais novas que vão para outro destinatário (ou outra chave): ficam de fora, para pagar depois. */
	moreRecipients: boolean;
};

export type AdvancePlanResult =
	| { status: "ok"; plan: AdvancePlan }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "not_installment" }
	| { status: "forbidden" }
	| { status: "no_share" };

/** Todas as parcelas que ainda existem da compra de `e`, em ordem de número (shares normalizadas). */
async function seriesDocs(db: Db, e: ExpenseDoc): Promise<ExpenseDoc[]> {
	const docs = await expensesCollection(db)
		.find({ groupId: e.groupId, "installment.seriesId": e.installment!.seriesId })
		.sort({ "installment.number": 1 })
		.toArray();
	const list = docs.length ? docs : [e];
	return list.map((d) => ({ ...d, shares: normalizeShares(d.shares) })).sort((a, b) => a.installment!.number - b.installment!.number);
}

type ScopeRow = { doc: ExpenseDoc; due: number; key: string };

/**
 * As parcelas em aberto de `shareUid` e a parte delas que entra no adiantamento: da mais antiga em diante, só enquanto o destinatário
 * é o mesmo da primeira. Ao pagar (`self`) destinatário = quem pagou + chave Pix (um Pix só paga uma chave); ao receber (`manual`),
 * só quem pagou. É a ÚNICA definição de "o que o adiantamento cobre": o plano (GET) e a gravação (POST) usam esta função.
 */
async function scopeOf(db: Db, group: Awaited<ReturnType<typeof findMemberGroup>> & object, docs: ExpenseDoc[], shareUid: string, mode: "self" | "manual") {
	const open = docs
		.map((doc) => {
			const s = doc.shares.find((x) => x.uid === shareUid);
			return { doc, due: s ? dueCents(s, doc.paidBy) : 0 };
		})
		.filter((r) => r.due > 0);
	const withPix = mode === "self" && open.length ? new Map((await fillMissingPix(db, [group], open.map((r) => r.doc))).map((d) => [d._id.toHexString(), d])) : null;
	const rows: ScopeRow[] = open.map((r) => ({
		...r,
		key: mode === "manual" ? r.doc.paidBy : (recipientKey(withPix?.get(r.doc._id.toHexString()) ?? r.doc) ?? `${r.doc.paidBy}\n-`),
	}));
	const scope = rows.filter((r, i) => rows.slice(0, i + 1).every((x) => x.key === rows[0].key));
	return { rows, scope, moreRecipients: scope.length < rows.length, recipientId: rows.length ? recipientIdFromKey(rows[0].key) : null, withPix };
}

/**
 * O que a tela mostra antes de adiantar: as parcelas em aberto da pessoa que vão para o mesmo destinatário (da mais antiga para a mais
 * nova), o total e quem recebe (com a chave Pix, só em `mode: "self"` e só para membros do grupo). A conta de verdade é refeita pelo
 * servidor ao gravar. Em `manual`, só quem pagou ou o administrador.
 */
export async function getAdvancePlan(db: Db, groupId: string, eid: string, uid: string, shareUid: string, mode: "self" | "manual" = "self"): Promise<AdvancePlanResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const current = await findExpense(db, groupId, eid);
	if (!current) return { status: "no_expense" };
	if (!current.installment) return { status: "not_installment" };
	// Mesma regra do POST: ao pagar, só a própria pessoa (ou quem age por ela) recebe o plano e a chave Pix.
	if (mode === "self" && !actsFor(group.members, uid, shareUid)) return { status: "forbidden" };
	const docs = await seriesDocs(db, current);
	if (!docs.some((d) => d.shares.some((s) => s.uid === shareUid && s.amountCents > 0))) return { status: "no_share" };
	const sc = await scopeOf(db, group, docs, shareUid, mode);
	const first = sc.scope[0]?.doc;
	if (first && mode === "manual" && expenseRole(group.members, uid, first.paidBy) === null) return { status: "forbidden" };
	const items: AdvancePlanItem[] = sc.scope.map((r) => ({ id: r.doc._id.toHexString(), number: r.doc.installment!.number, dueDate: r.doc.dueDate ?? null, dueCents: r.due }));
	let recipient: AdvancePlan["recipient"] = null;
	if (first && sc.recipientId) {
		const pix = mode === "self" ? sc.withPix?.get(first._id.toHexString())?.pix : undefined;
		const dir = directory(group, await loadPeople(db, [first.paidBy]), uid);
		recipient = { id: sc.recipientId, name: pix?.payeeName ?? dir.name(first.paidBy), pix: pix ? { type: pix.type, key: pix.key, payeeName: pix.payeeName } : null };
	}
	return {
		status: "ok",
		plan: {
			shareUid,
			currentNumber: current.installment.number,
			thisDueCents: sc.scope.find((r) => r.doc._id.equals(current._id))?.due ?? 0,
			totalDueCents: items.reduce((t, i) => t + i.dueCents, 0),
			items,
			recipient,
			moreRecipients: sc.moreRecipients,
		},
	};
}

/** O que foi de fato gravado, por parcela e no total. */
export type AdvanceDone = { totalCents: number; items: AdvanceSummaryItem[]; hasReceipt: boolean; batchId: string };

export type AdvanceOutcome =
	/** `expense` = null quando o pagamento foi gravado mas a leitura da despesa falhou depois (a tela recarrega). */
	| { status: "ok"; expense: ExpenseDetail | null; advance: AdvanceDone; /** Um só fato por adiantamento (para avisar). */ fact: AdvanceFact }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "not_installment" }
	| { status: "forbidden" }
	| { status: "no_share" }
	/** Alguém mexeu nas parcelas no meio do caminho: nada ficou gravado. */
	| { status: "conflict" }
	/** O total que a tela mostrava não é mais o de agora, ou uma parte mudou antes de gravar: nada ficou gravado. */
	| { status: "stale" }
	/** O destinatário (ou a chave Pix) das parcelas não é o que a tela viu: nada ficou gravado. */
	| { status: "recipient_changed" }
	/** Erro no meio da gravação ou do desfazer: parte do pagamento pode ter sido registrada. */
	| { status: "uncertain" }
	| { status: "invalid_amount" }
	| { status: "too_much" }
	| { status: "too_many_parts" };

export type AdvanceArgs = {
	groupId: string;
	eid: string;
	uid: string;
	/** A pessoa que deve (a parte que está sendo adiantada). */
	shareUid: string;
	/** "self" = a própria pessoa (ou quem age por ela) pagou; "manual" = quem pagou a despesa (ou o administrador) recebeu. */
	mode: "self" | "manual";
	amountCents: number;
	/** O total que a tela mostrava faltando (as parcelas do plano). Se não é o de agora, "stale". */
	expectedDueCents: number;
	/** Quem recebe, como a tela viu no plano (`recipient.id`); se mudou (outro destinatário ou chave), "recipient_changed". */
	recipientId: string;
	file?: SniffedFile;
	now?: Date;
};

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown } | { skipped: true };

/** Roda `fn` em todos com no máximo `limit` ao mesmo tempo; nunca lança. Depois que `stop()` vira verdadeiro, não começa mais nenhum (os em andamento terminam). */
async function runLimited<T, R>(list: T[], limit: number, stop: () => boolean, fn: (t: T) => Promise<R>): Promise<Settled<R>[]> {
	const out: Settled<R>[] = list.map(() => ({ skipped: true }));
	let next = 0;
	const worker = async () => {
		while (next < list.length) {
			const i = next++;
			if (stop()) return;
			try {
				out[i] = { ok: true, value: await fn(list[i]) };
			} catch (error) {
				out[i] = { ok: false, error };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
	return out;
}

/**
 * Adianta parcelas: abate `amountCents` das parcelas em aberto de `shareUid`, da MAIS ANTIGA para a mais nova (a ordem em que
 * acontecem, mesmo que a tela esteja numa parcela mais nova), com UM comprovante e UM lote.
 *
 * O servidor NUNCA aceita a distribuição do cliente: relê as parcelas, confere o total que falta (`expectedDueCents`) e calcula a
 * distribuição com `distributeAdvance`. Garantia de "tudo ou nada":
 * 1. Tudo é validado ANTES de qualquer upload ou escrita (permissão em CADA parcela tocada, mesmo destinatário, limite de pagamentos
 *    parciais, valores): erro de validação nunca deixa nada gravado nem arquivo órfão.
 * 2. As parcelas são gravadas com `mutateShares` (version, uma nova tentativa), até `WRITE_CONCURRENCY` ao mesmo tempo, cada uma
 *    conferindo `paidCents` E o que falta (se a divisão mudou no meio, para tudo). A distribuição já está decidida antes de gravar,
 *    então a ordem de gravação não muda o estado final: parcela anterior quitada antes da seguinte vale se tudo gravou.
 * 3. Se alguma falhar, as já gravadas voltam às cotas anteriores (condicionado a ninguém ter mexido; senão `undoAdvanceSlice` tira só
 *    o pagamento do lote, e só se for seguro) e a chamada falha com `conflict`/`stale`; o comprovante some junto (só é apagado se nenhuma
 *    cota o referencia). Se houver erro de banco ou o desfazer não for completo, devolve `uncertain` (parte pode ter sido gravada).
 */
export async function advanceInstallments(db: Db, store: AttachmentStore, args: AdvanceArgs): Promise<AdvanceOutcome> {
	const { groupId, eid, uid, shareUid, mode, amountCents, expectedDueCents, file } = args;
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const current = await findExpense(db, groupId, eid);
	if (!current) return { status: "no_expense" };
	if (!current.installment) return { status: "not_installment" };
	const members = group.members;
	// Ao pagar: só a própria pessoa (ou quem cuida dela), e nunca a parte de quem pagou aquela parcela. Ao receber: quem pagou ou o administrador.
	const canAct = (paidBy: string) => (mode === "self" ? actsFor(members, uid, shareUid) && shareUid !== paidBy : expenseRole(members, uid, paidBy) !== null);

	// Ao pagar, a permissão vem antes de "não tem parte": quem não age pela pessoa recebe sempre a mesma recusa (igual ao GET).
	if (mode === "self" && !actsFor(members, uid, shareUid)) return { status: "forbidden" };
	const docs = await seriesDocs(db, current);
	if (!docs.some((d) => d.shares.some((s) => s.uid === shareUid && s.amountCents > 0))) return { status: "no_share" };
	const sc = await scopeOf(db, group, docs, shareUid, mode);
	// Permissão na primeira parcela do adiantamento antes de qualquer outra resposta (a de CADA parcela tocada vem depois).
	const firstDoc = sc.scope[0]?.doc ?? current;
	if (!canAct(firstDoc.paidBy)) return { status: "forbidden" };
	// Quem recebe (e a chave Pix) tem de ser o que a tela mostrou ao gerar o Pix.
	if (sc.recipientId !== null && sc.recipientId !== args.recipientId) return { status: "recipient_changed" };
	const items: AdvanceItem[] = sc.scope.map((r) => ({ id: r.doc._id.toHexString(), number: r.doc.installment!.number, dueCents: r.due }));
	if (totalDue(items) !== expectedDueCents) return { status: "stale" };
	const dist = distributeAdvance(items, amountCents);
	if (!dist.ok) return { status: dist.error === "invalid" ? "invalid_amount" : "too_much" };

	const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));
	const touched = dist.allocations.map((a) => ({ a, doc: byId.get(a.id)! }));
	// Permissão em CADA parcela tocada (quem pagou pode mudar de uma parcela para outra, ex.: edição ou troca de administrador).
	if (!touched.every((t) => canAct(t.doc.paidBy))) return { status: "forbidden" };

	const batchId = randomId();
	const batch = { id: batchId, totalCents: amountCents, count: touched.length };
	const planned = new Map(touched.map((t) => [t.a.id, { paid: t.doc.shares.find((s) => s.uid === shareUid)!.paidCents, due: t.a.cents + t.a.remainingCents }]));
	const slice = (e: ExpenseDoc, id: string, cents: number, receipt: AttachmentMeta | undefined) =>
		applyAdvanceSlice(e.shares, e.paidBy, shareUid, cents, now, uid, {
			method: mode,
			asAdmin: mode === "manual" && expenseRole(members, uid, e.paidBy) === "admin",
			receipt,
			batch,
			partId: randomId(),
			expectedPaidCents: planned.get(id)!.paid,
			expectedDueCents: planned.get(id)!.due,
		});
	// Ensaio sem gravar: limite de pagamentos parciais, parte que mudou etc. Qualquer recusa acontece antes do upload.
	for (const t of touched) {
		const probe = slice(t.doc, t.a.id, t.a.cents, undefined);
		if ("error" in probe) return probe.error === "limit" ? { status: "too_many_parts" } : probe.error === "invalid" ? { status: "invalid_amount" } : probe.error === "no_share" ? { status: "no_share" } : { status: "stale" };
	}

	const receipt = file ? await putBatchReceipt(store, { batchId, bytes: file.bytes, name: file.name, contentType: file.contentType }) : undefined;
	type Written = { before: ExpenseDoc; doc: ExpenseDoc };
	let stopped = false;
	const writeOne = async (t: (typeof touched)[number]): Promise<{ written: Written } | { failure: AdvanceOutcome }> => {
		try {
			const r = await mutateShares(db, groupId, t.a.id, (e) => {
				if (!canAct(e.paidBy)) return { error: "forbidden" };
				const s = slice(e, t.a.id, t.a.cents, receipt);
				return "error" in s ? { error: s.error } : { shares: s.shares, changed: s.changed };
			});
			if (r.kind === "ok" && r.wrote) return { written: { before: r.before, doc: r.doc } };
			stopped = true;
			return {
				failure:
					r.kind === "conflict" || r.kind === "no_expense" || r.kind === "ok"
						? { status: "conflict" }
						: r.error === "limit"
							? { status: "too_many_parts" }
							: r.error === "forbidden"
								? { status: "forbidden" }
								: { status: "stale" },
			};
		} catch (err) {
			stopped = true;
			throw err;
		}
	};
	// A parcela mais antiga é gravada SOZINHA primeiro: serve de trava. Dois envios idênticos ao mesmo tempo disputam a mesma parcela,
	// o primeiro vence e o outro sai com 409 sem ter gravado nada; só depois as demais vão em paralelo (com teto).
	const lock = await runLimited(touched.slice(0, 1), 1, () => stopped, writeOne);
	const rest = await runLimited(touched.slice(1), WRITE_CONCURRENCY, () => stopped, writeOne);
	const results = [...lock, ...rest];
	const written: Written[] = [];
	const unknown: ExpenseDoc[] = []; // gravação que lançou: pode ou não ter entrado
	let failure: AdvanceOutcome | null = null;
	results.forEach((r, i) => {
		if ("skipped" in r) return;
		if (!r.ok) {
			unknown.push(byId.get(touched[i].a.id)!);
			return;
		}
		if ("written" in r.value) written.push(r.value.written);
		else failure ??= r.value.failure;
	});
	if (failure || unknown.length > 0) {
		const clean = await rollback(db, groupId, shareUid, batchId, written, unknown);
		// Um arquivo sobrando é melhor que uma cota apontando para arquivo apagado: com gravação em estado desconhecido e desfazer que
		// não fechou limpo, o comprovante fica. Erro ao limpar nunca muda o resultado já decidido.
		if (receipt && !(unknown.length > 0 && !clean)) await safeRelease(db, store, [receipt.key]);
		return unknown.length > 0 || !clean ? { status: "uncertain" } : failure!;
	}

	// O resumo é montado a partir do que FOI gravado (antes x depois de cada parcela), não do que foi planejado.
	const summary: AdvanceSummaryItem[] = written
		.map((w) => {
			const b = w.before.shares.find((s) => s.uid === shareUid)!;
			const a = w.doc.shares.find((s) => s.uid === shareUid)!;
			const left = dueCents(a, w.doc.paidBy);
			return { number: w.doc.installment!.number, cents: a.paidCents - b.paidCents, settled: left === 0, remainingCents: left };
		})
		.sort((x, y) => x.number - y.number);
	// O aviso sai das parcelas DE FATO gravadas: o destinatário é o delas (não o da parcela aberta na tela) e o link leva à primeira tocada.
	const firstWritten = written.reduce((a, b) => (b.doc.installment!.number < a.doc.installment!.number ? b : a)).doc;
	const fact: AdvanceFact = {
		groupId,
		expenseId: firstWritten._id.toHexString(),
		description: firstWritten.description,
		paidBy: firstWritten.paidBy,
		debtorUid: shareUid,
		actorUid: uid,
		manual: mode === "manual" && !actsFor(members, uid, shareUid),
		totalCents: summary.reduce((t, i) => t + i.cents, 0),
		items: summary,
	};
	// Só uma referência ao comprovante para o aviso; parte ausente (não deveria) não impede nada: o aviso sai sem a referência.
	const writtenShare = firstWritten.shares.find((x) => x.uid === shareUid);
	const receiptSpec = receipt && writtenShare ? batchReceiptSpec(writtenShare, batchId) : undefined;
	if (receiptSpec) fact.receipt = receiptSpec;
	const advance: AdvanceDone = { totalCents: fact.totalCents, items: summary, hasReceipt: Boolean(receipt), batchId };
	// Gravou = sucesso: se a leitura do detalhe falhar (despesa apagada, pessoa saiu), a tela recarrega.
	let expense: ExpenseDetail | null = null;
	try {
		const detail = await getExpenseDetail(db, groupId, eid, uid, now);
		if (detail.status === "ok") expense = detail.expense;
	} catch (err) {
		console.error("advance detail error:", describeError(err));
	}
	return { status: "ok", expense, advance, fact };
}

/** `releaseReceipts` que nunca lança (limpeza de arquivo não pode virar erro 500 nem mudar o resultado). */
async function safeRelease(db: Db, store: AttachmentStore, keys: string[]): Promise<void> {
	try {
		await releaseReceipts(db, store, keys);
	} catch (err) {
		console.error("advance release error:", describeError(err));
	}
}

/**
 * Desfaz o que foi gravado (em paralelo, de leve). Primeiro volta às cotas de antes, se ninguém mexeu desde a gravação; se mexeram,
 * `undoAdvanceSlice` tira só o pagamento deste lote (e só se for seguro). `unknown` = gravações que lançaram erro: só o segundo
 * caminho (pode não ter entrado nada). Devolve true quando tudo ficou como antes; nunca lança.
 */
async function rollback(db: Db, groupId: string, shareUid: string, batchId: string, written: { before: ExpenseDoc; doc: ExpenseDoc }[], unknown: ExpenseDoc[]): Promise<boolean> {
	const fallback = async (doc: ExpenseDoc): Promise<boolean> => {
		let safe = true;
		try {
			await mutateShares(db, groupId, doc._id.toHexString(), (e) => {
				const undone = undoAdvanceSlice(e.shares, e.paidBy, shareUid, batchId);
				if (undone && "unsafe" in undone) {
					safe = false;
					return { shares: e.shares, changed: false };
				}
				return undone ? { shares: undone.shares, changed: true } : { shares: e.shares, changed: false };
			});
		} catch (err) {
			console.error("advance rollback fallback error:", describeError(err));
			return false;
		}
		return safe;
	};
	const oks = await runLimited([...written.map((w) => ({ w })), ...unknown.map((doc) => ({ doc }))], WRITE_CONCURRENCY, () => false, async (x): Promise<boolean> => {
		if ("w" in x) {
			try {
				const res = await expensesCollection(db).updateOne(
					{ _id: x.w.doc._id, groupId: x.w.doc.groupId, version: x.w.doc.version },
					{ $set: { shares: x.w.before.shares, updatedAt: new Date() }, $inc: { version: 1 } },
				);
				if (res.matchedCount > 0) return true;
			} catch (err) {
				console.error("advance rollback error:", describeError(err));
			}
			return fallback(x.w.doc);
		}
		return fallback(x.doc);
	});
	return oks.every((r) => "ok" in r && r.ok && r.value);
}
