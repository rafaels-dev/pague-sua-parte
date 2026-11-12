import { ObjectId, type Db } from "mongodb";
import { groupsCollection, type GroupDoc } from "@/lib/groups/repo";
import { actsFor, canLaunchPaidBy, expenseRole, isGroupAdmin, isManagedMember, isManagedUid, isObjectIdHex } from "@/lib/groups/helpers";
import type { PixKey } from "@/lib/pix/key";
import {
	deleteAttachments,
	putAttachment,
	putReceipt,
	randomId,
	type AttachmentMeta,
	type AttachmentStore,
} from "@/lib/storage/attachments";
import { describeError } from "@/lib/api/http";
import { payerPix } from "./payer-pix";
import { recurrencesCollection } from "@/lib/recurrences/collection";
import { buildRecurringExpense, materializeSafely } from "@/lib/recurrences/materialize";
import { currentPeriod, dueDateFor } from "@/lib/recurrences/period";
import { usersCollection, type UserDoc } from "@/lib/users/repo";
import { getBalancesForUids, sumBalances, ZERO_BALANCE } from "./balances";
import { groupDebts } from "./group-debts";
import { buildOpenLists, UPCOMING_DAYS, type OpenExpense, type OpenSource, type UpcomingPayment } from "./group-open";
import { addDays, installmentDueDates, isPastDue, todayInSaoPaulo } from "./dates";
import {
	addHelper,
	droppedReceiptKeys,
	dueCents,
	hasPayments,
	isHelper,
	normalizeShares,
	orderShares,
	participantUidsOf,
	payShare,
	receiptKeysOfShare,
	recalcShares,
	refundCents,
	settleShare,
	shareStatus,
	undoShare,
	type Balance,
	type ExpenseShare,
	type ShareMethod,
	type ShareStatus,
} from "./shares";
import { splitEqually } from "./split";
import type { ExpenseEdit, ExpenseInput, ParticipantsScope, SniffedFile } from "./validation";

export type { ExpenseShare, ShareMethod, ShareStatus } from "./shares";

export type ExpenseDoc = {
	_id: ObjectId;
	groupId: ObjectId;
	createdBy: string;
	paidBy: string;
	description: string;
	amountCents: number;
	date: string;
	/** Chave de quem pagou NO LANÇAMENTO. Ausente quando quem pagou não tinha chave no lançamento (o administrador lançando por outra pessoa, ou um mês de despesa fixa gerado sem chave): vale a atual dele (`fillMissingPix`). */
	pix?: PixKey & { payeeName: string };
	shares: ExpenseShare[];
	/** Cresce a cada escrita em `shares` (concorrência otimista). Ausente em documentos antigos = 0. */
	version?: number;
	attachments: AttachmentMeta[];
	/** Vencimento (compra no cartão), YYYY-MM-DD. */
	dueDate?: string;
	/** Presente quando a despesa é uma parcela de uma série. */
	installment?: InstallmentInfo;
	/** Presente quando a despesa foi gerada por uma despesa fixa: o mês (YYYY-MM) a que se refere. */
	recurrence?: RecurrenceRef;
	createdAt: Date;
	updatedAt: Date;
};

export type RecurrenceRef = { id: string; period: string };
export type InstallmentInfo = { seriesId: string; number: number; count: number };

export function expensesCollection(db: Db) {
	return db.collection<ExpenseDoc>("expenses");
}

const ATTACHMENT_ID_RE = /^[0-9a-f]{32}$/;
const personName = (u?: Pick<UserDoc, "name" | "displayName">) => u?.displayName?.trim() || u?.name || "Participante";

export async function findMemberGroup(db: Db, id: string, uid: string): Promise<GroupDoc | null> {
	if (!isObjectIdHex(id)) return null;
	return groupsCollection(db).findOne({ _id: new ObjectId(id), "members.uid": uid });
}

export type PersonDoc = Pick<UserDoc, "_id" | "name" | "displayName" | "picture">;

/** Projeção explícita: e-mail e chave Pix de ninguém saem do banco aqui. Pessoas sem login não têm documento. */
export async function loadPeople(db: Db, uids: string[]): Promise<Map<string, PersonDoc>> {
	const real = uids.filter((u) => !isManagedUid(u));
	if (real.length === 0) return new Map();
	const users = await usersCollection(db)
		.find<PersonDoc>({ _id: { $in: real } }, { projection: { name: 1, displayName: 1, picture: 1 } })
		.toArray();
	return new Map(users.map((u) => [u._id, u]));
}

/** Nomes, tipos e responsáveis, sempre pelo grupo ATUAL (quem saiu vira "Participante"). */
export type Directory = {
	name: (uid: string) => string;
	picture: (uid: string) => string | null;
	kind: (uid: string) => "user" | "managed";
	youManage: (uid: string) => boolean;
	managedByName: (uid: string) => string | null;
};

export function directory(group: GroupDoc, people: Map<string, PersonDoc>, caller: string): Directory {
	const entry = (uid: string) => group.members.find((m) => m.uid === uid);
	const kind = (uid: string): "user" | "managed" => (entry(uid)?.kind === "managed" || (!entry(uid) && isManagedUid(uid)) ? "managed" : "user");
	const name = (uid: string) => (kind(uid) === "managed" ? entry(uid)?.name?.trim() || "Participante" : personName(people.get(uid)));
	return {
		name,
		picture: (uid) => (kind(uid) === "managed" ? null : (people.get(uid)?.picture ?? null)),
		kind,
		youManage: (uid) => uid !== caller && actsFor(group.members, caller, uid),
		managedByName: (uid) => {
			const by = entry(uid)?.managedBy;
			return by && entry(uid)?.kind === "managed" ? name(by) : null;
		},
	};
}

/** Todos os uids cujos nomes a tela pode precisar (inclui responsáveis). */
function uidsToLoad(group: GroupDoc, uids: string[]): string[] {
	const out = new Set(uids);
	for (const u of uids) {
		const by = group.members.find((m) => m.uid === u && m.kind === "managed")?.managedBy;
		if (by) out.add(by);
	}
	return [...out];
}

// ---------- detalhe ----------

export type ExpenseDetail = {
	id: string;
	groupId: string;
	description: string;
	amountCents: number;
	date: string;
	createdAt: string;
	canDelete: boolean;
	/** Quem pagou a despesa (ou o administrador do grupo) pode marcar as partes dos outros como pagas. */
	canMarkPaid: boolean;
	/** Quem pagou (ou o administrador) pode mudar quem divide. */
	canEditParticipants: boolean;
	/** Quem pagou (ou o administrador) pode editar descrição, valor, datas e a divisão. */
	canEdit: boolean;
	/** Você gerencia esta despesa só porque administra o grupo (não foi você quem pagou). */
	adminOnly: boolean;
	/** O usuário poderia entrar na divisão ("Quero ajudar") como ele mesmo. */
	canHelp: boolean;
	/** Pessoas sem login que o usuário cuida e poderiam entrar na divisão. */
	helpAsUids: string[];
	/** Quanto uma pessoa nova pagaria (divisão igual entre quem divide hoje + 1); null quando ninguém pode ajudar. */
	helpShareCents: number | null;
	/** Quem pagou é a única pessoa que divide a despesa. */
	ownerAlone: boolean;
	/** Quem divide agora (cotas com valor > 0). */
	participantUids: string[];
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean; kind: "user" | "managed"; youManage: boolean };
	/** `null` = quem pagou ainda não cadastrou a chave Pix (ninguém consegue pagar pelo app até cadastrar). */
	pix: { type: string; key: string; payeeName: string } | null;
	/** Quem lançou, quando não é quem pagou nem alguém que age por ele (o administrador lançando por outro). */
	launchedBy: { name: string; admin: boolean } | null;
	shares: {
		uid: string;
		name: string;
		picture: string | null;
		amountCents: number;
		paidCents: number;
		dueCents: number;
		refundCents: number;
		participates: boolean;
		/** Entrou pela ação "Quero ajudar" e ainda divide a despesa. */
		helped: boolean;
		status: ShareStatus;
		isYou: boolean;
		kind: "user" | "managed";
		youManage: boolean;
		managedByName: string | null;
		paidAt: string | null;
		method: ShareMethod | null;
		/** Marcada como paga pelo administrador do grupo (e não por quem pagou); `markedByName` = quem marcou. */
		markedByAdmin: boolean;
		markedByName: string | null;
		/** Só para quem pode baixar (a pessoa, quem age por ela ou por quem pagou); null para os demais. */
		receipt: { name: string; contentType: string; size: number } | null;
		/** Pago num lote ("pagar tudo de uma vez"); visível para quem vê o comprovante. */
		batch: { totalCents: number; count: number } | null;
		/** Devolução já feita (o que a pessoa pagou a mais voltou para ela); `receipt` só para quem pode ver. */
		refund: { cents: number; at: string; byAdmin: boolean; markedByName: string | null; receipt: { name: string; contentType: string; size: number } | null; batch: { totalCents: number; count: number } | null } | null;
		/** Você (quem pagou ou o administrador) pode marcar a devolução desta pessoa, ou desfazê-la. */
		canRefund: boolean;
		canUndoRefund: boolean;
		/**
		 * Só para quem paga a devolução (quem pagou a despesa ou age por ele): a chave Pix de quem recebe de volta.
		 * `null` = a pessoa não tem chave Pix cadastrada (a tela explica); ausente = você não paga esta devolução.
		 */
		refundPix?: { type: string; key: string; payeeName: string } | null;
		/** Você age por esta pessoa e a parte dela está pendente: pode avisar que pagou. */
		canPay: boolean;
		/** Você age por esta pessoa e ela já pagou o valor todo: pode anexar ou trocar o comprovante. */
		canAddReceipt: boolean;
	}[];
	attachments: { id: string; name: string; contentType: string; size: number }[];
	dueDate: string | null;
	installment: InstallmentInfo | null;
	recurrence: RecurrenceRef | null;
	/** Venceu (antes de hoje, em São Paulo) e ainda há cota de outra pessoa com valor em aberto. */
	overdue: boolean;
	/** Todas as parcelas da série que ainda existem, em ordem. */
	series: { count: number; items: { id: string; number: number; dueDate: string | null; settled: boolean }[] } | null;
};

/** Nenhuma cota de outra pessoa com valor em aberto. */
const noDue = (e: { paidBy: string; shares: ExpenseShare[] }) => !e.shares.some((s) => dueCents(s, e.paidBy) > 0);
/** Nada a receber nem a devolver para ninguém. */
const fullySettled = (e: { paidBy: string; shares: ExpenseShare[] }) =>
	e.shares.every((s) => dueCents(s, e.paidBy) === 0 && refundCents(s, e.paidBy) === 0);
const isOverdue = (e: { paidBy: string; shares: ExpenseShare[]; dueDate?: string }, today: string) =>
	isPastDue(e.dueDate, today) && !noDue(e);

/**
 * "Quero ajudar": quem poderia entrar na divisão. Ajuda quem é membro, não é quem pagou (nem age por quem pagou:
 * o responsável pela pessoa sem login que pagou é, na prática, quem pagou) e ainda não divide.
 * Só vale se o valor ainda se divide em mais uma parte.
 */
export function helpInfo(
	e: { paidBy: string; amountCents: number; shares: ExpenseShare[] },
	members: GroupDoc["members"],
	uid: string,
) {
	const participants = participantUidsOf(e.shares);
	const ownerAlone = participants.length === 1 && participants[0] === e.paidBy;
	let helpShareCents: number | null = null;
	let divisible = false;
	try {
		const probe = "\u0000novo";
		helpShareCents = splitEqually(e.amountCents, [...participants, probe], e.paidBy).find((x) => x.uid === probe)!.amountCents;
		divisible = true;
	} catch {
		/* pequeno demais para mais uma parte */
	}
	const eligible = (u: string) => divisible && u !== e.paidBy && members.some((m) => m.uid === u) && !participants.includes(u);
	const canHelp = !actsFor(members, uid, e.paidBy) && eligible(uid);
	const helpAsUids = members.filter((m) => m.kind === "managed" && m.managedBy === uid && eligible(m.uid)).map((m) => m.uid);
	return { canHelp, helpAsUids, helpShareCents: canHelp || helpAsUids.length > 0 ? helpShareCents : null, ownerAlone };
}

/** Quem age pelo dono (ele mesmo ou o responsável por ele, no grupo de agora) ou administra o grupo. */
function canDeleteExpense(e: ExpenseDoc, group: GroupDoc, uid: string) {
	return expenseRole(group.members, uid, e.paidBy) !== null && !hasPayments(e);
}

/** Parcelas que ainda existem da série de `e` (inclui `e`). `known` evita a consulta quando já estão em memória. */
async function seriesOf(db: Db, e: ExpenseDoc, known?: ExpenseDoc[]) {
	if (!e.installment) return null;
	const docs =
		known ??
		(await expensesCollection(db)
			.find(
				{ groupId: e.groupId, "installment.seriesId": e.installment.seriesId },
				{ projection: { installment: 1, dueDate: 1, shares: 1, paidBy: 1 } },
			)
			.sort({ "installment.number": 1 })
			.toArray());
	const items = docs
		.filter((d) => d.installment)
		.map((d) => ({
			id: d._id.toHexString(),
			number: d.installment!.number,
			dueDate: d.dueDate ?? null,
			settled: noDue({ paidBy: d.paidBy, shares: normalizeShares(d.shares) }),
		}))
		.sort((a, b) => a.number - b.number);
	return { count: e.installment.count, items };
}

export type PixInfo = { type: string; key: string; payeeName: string };

/**
 * Única busca de chave Pix de quem recebe (uma devolução, por exemplo): a da própria pessoa, ou, se é uma pessoa sem login,
 * a cadastrada no grupo para ela. Uma consulta só ao banco para todas as pessoas e grupos pedidos.
 * Chave do mapa: `${groupId}:${uid}`; quem não tem chave Pix fica de fora.
 */
export async function loadPixKeys(
	db: Db,
	groups: Pick<GroupDoc, "_id" | "members">[],
	uidsByGroup: Map<string, string[]>,
): Promise<Map<string, PixInfo>> {
	const out = new Map<string, PixInfo>();
	const real = new Set<string>();
	const realByGroup: [string, string][] = [];
	for (const g of groups) {
		const gid = g._id.toHexString();
		for (const u of new Set(uidsByGroup.get(gid) ?? [])) {
			const m = g.members.find((x) => x.uid === u);
			// Quem saiu do grupo não tem a chave Pix servida a ninguém: a chave só circula entre membros do mesmo grupo.
			if (!m) continue;
			if (m.kind === "managed") {
				if (m.pixKey) out.set(`${gid}:${u}`, { type: m.pixKey.type, key: m.pixKey.key, payeeName: m.name?.trim() || "Participante" });
			} else {
				real.add(u);
				realByGroup.push([gid, u]);
			}
		}
	}
	if (real.size > 0) {
		const users = await usersCollection(db)
			.find({ _id: { $in: [...real] } }, { projection: { name: 1, displayName: 1, pixKey: 1 } })
			.toArray();
		const byId = new Map(users.map((u) => [u._id, u]));
		for (const [gid, u] of realByGroup) {
			const user = byId.get(u);
			if (user?.pixKey) out.set(`${gid}:${u}`, { type: user.pixKey.type, key: user.pixKey.key, payeeName: personName(user) });
		}
	}
	return out;
}

const PIX_TYPES: string[] = ["cpf", "cnpj", "email", "phone", "random"];

/**
 * Despesas sem cópia da chave Pix (lançadas pelo administrador por alguém sem chave, ou mês de despesa fixa gerado sem chave) usam a atual de quem pagou.
 * Chave de formato inválido conta como ausente.
 * Sem chave ainda, a despesa fica de fora (não há como pagar). Uma só consulta para todas.
 */
export async function fillMissingPix<T extends { groupId: ObjectId; paidBy: string; pix?: ExpenseDoc["pix"] }>(
	db: Db,
	groups: Pick<GroupDoc, "_id" | "members">[],
	expenses: T[],
): Promise<(T & { pix: NonNullable<ExpenseDoc["pix"]> })[]> {
	const missing = expenses.filter((e) => !e.pix);
	if (missing.length === 0) return expenses as (T & { pix: NonNullable<ExpenseDoc["pix"]> })[];
	const byGroup = new Map<string, string[]>();
	for (const e of missing) byGroup.set(e.groupId.toHexString(), [...(byGroup.get(e.groupId.toHexString()) ?? []), e.paidBy]);
	const keys = await loadPixKeys(db, groups, byGroup);
	const out: (T & { pix: NonNullable<ExpenseDoc["pix"]> })[] = [];
	for (const e of expenses) {
		const pix = e.pix ?? keys.get(`${e.groupId.toHexString()}:${e.paidBy}`);
		if (pix && PIX_TYPES.includes(pix.type) && typeof pix.key === "string" && pix.key.trim() !== "") out.push({ ...e, pix: { type: pix.type as PixKey["type"], key: pix.key, payeeName: pix.payeeName } });
	}
	return out;
}

async function toDetail(db: Db, e: ExpenseDoc, group: GroupDoc, uid: string, now: Date, known?: ExpenseDoc[]): Promise<ExpenseDetail> {
	const markers = e.shares.flatMap((s) => [...(s.markedByAdmin && s.markedBy ? [s.markedBy] : []), ...(s.refund?.byAdmin ? [s.refund.markedBy] : [])]);
	const people = await loadPeople(db, uidsToLoad(group, [...new Set([e.paidBy, e.createdBy, ...e.shares.map((s) => s.uid), ...markers].filter(Boolean))]));
	const dir = directory(group, people, uid);
	const view = (u: string) => ({ uid: u, name: dir.name(u), picture: dir.picture(u), isYou: u === uid });
	const role = expenseRole(group.members, uid, e.paidBy);
	// Quem pagou (ou o administrador do grupo) gerencia a despesa: marca pagamentos, muda a divisão, edita, vê comprovantes.
	const owns = role !== null;
	// A chave Pix de quem recebe de volta só vai para quem paga a devolução (não para o administrador nem para os outros).
	const gid = group._id.toHexString();
	const refundPixes =
		role === "owner" ? await loadPixKeys(db, [group], new Map([[gid, e.shares.filter((s) => refundCents(s, e.paidBy) > 0).map((s) => s.uid)]])) : null;
	const pix = (await fillMissingPix(db, [group], [e]))[0]?.pix ?? null;
	const creator = e.createdBy;
	const launched = creator && creator !== e.paidBy && !actsFor(group.members, creator, e.paidBy) && group.members.some((m) => m.uid === creator);
	return {
		id: e._id.toHexString(),
		groupId: e.groupId.toHexString(),
		description: e.description,
		amountCents: e.amountCents,
		date: e.date,
		createdAt: e.createdAt.toISOString(),
		canDelete: canDeleteExpense(e, group, uid),
		canMarkPaid: owns,
		canEditParticipants: owns,
		canEdit: owns,
		adminOnly: role === "admin",
		...helpInfo(e, group.members, uid),
		participantUids: participantUidsOf(e.shares),
		paidBy: { ...view(e.paidBy), kind: dir.kind(e.paidBy), youManage: dir.youManage(e.paidBy) },
		pix: pix ? { type: pix.type, key: pix.key, payeeName: pix.payeeName } : null,
		launchedBy: launched ? { name: dir.name(creator), admin: isGroupAdmin(group.members, creator) } : null,
		shares: orderShares(e.shares, e.paidBy, dir.name).map((s) => {
			const actsForShare = actsFor(group.members, uid, s.uid);
			const status = shareStatus(s, e.paidBy);
			return {
				...view(s.uid),
				kind: dir.kind(s.uid),
				youManage: dir.youManage(s.uid),
				managedByName: dir.managedByName(s.uid),
				amountCents: s.amountCents,
				paidCents: s.paidCents,
				dueCents: dueCents(s, e.paidBy),
				refundCents: refundCents(s, e.paidBy),
				participates: s.amountCents > 0,
				helped: isHelper(s),
				status,
				paidAt: s.paidCents > 0 && s.paidAt ? new Date(s.paidAt).toISOString() : null,
				method: s.paidCents > 0 ? (s.method ?? null) : null,
				markedByAdmin: s.paidCents > 0 && s.method === "manual" && s.markedByAdmin === true,
				markedByName: s.paidCents > 0 && s.method === "manual" && s.markedByAdmin === true && s.markedBy ? dir.name(s.markedBy) : null,
				refund: s.refund
					? {
							cents: s.refund.cents,
							at: new Date(s.refund.at).toISOString(),
							byAdmin: s.refund.byAdmin === true,
							markedByName: s.refund.byAdmin ? dir.name(s.refund.markedBy) : null,
							receipt: s.refund.receipt && (actsForShare || owns) ? { name: s.refund.receipt.name, contentType: s.refund.receipt.contentType, size: s.refund.receipt.size } : null,
							batch: s.refund.batch && (actsForShare || owns) ? { totalCents: s.refund.batch.totalCents, count: s.refund.batch.count } : null,
						}
					: null,
				canRefund: owns && status === "refund",
				canUndoRefund: owns && s.refund !== undefined,
				...(refundPixes && status === "refund" ? { refundPix: refundPixes.get(`${gid}:${s.uid}`) ?? null } : {}),
				receipt:
					s.receipt && (actsForShare || owns) ? { name: s.receipt.name, contentType: s.receipt.contentType, size: s.receipt.size } : null,
				batch: s.batch && (actsForShare || owns) ? { totalCents: s.batch.totalCents, count: s.batch.count } : null,
				canPay: actsForShare && status === "pending",
				canAddReceipt: actsForShare && s.uid !== e.paidBy && s.amountCents > 0 && s.paidCents === s.amountCents,
			};
		}),
		attachments: e.attachments.map((a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size })),
		dueDate: e.dueDate ?? null,
		installment: e.installment ?? null,
		recurrence: e.recurrence ?? null,
		overdue: isOverdue(e, todayInSaoPaulo(now)),
		series: await seriesOf(db, e, known),
	};
}

export type GetExpenseResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" };

export async function findExpense(db: Db, groupId: string, eid: string) {
	if (!isObjectIdHex(eid)) return null;
	const e = await expensesCollection(db).findOne({ _id: new ObjectId(eid), groupId: new ObjectId(groupId) });
	// Lê cotas do modelo antigo (status) como paidCents, num só lugar.
	return e ? { ...e, shares: normalizeShares(e.shares) } : null;
}

export async function getExpenseDetail(db: Db, groupId: string, eid: string, uid: string, now: Date = new Date()): Promise<GetExpenseResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const e = await findExpense(db, groupId, eid);
	if (!e) return { status: "no_expense" };
	return { status: "ok", expense: await toDetail(db, e, group, uid, now) };
}

// ---------- criação ----------

export type CreateResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	/** `name` presente quando a chave que falta é de uma pessoa sem login. */
	| { status: "no_pix"; name?: string }
	| { status: "invalid"; error: string; field: string };

export async function createExpense(
	db: Db,
	store: AttachmentStore,
	args: { groupId: string; uid: string; input: ExpenseInput; files: SniffedFile[]; now?: Date },
): Promise<CreateResult> {
	const { groupId, uid, input, files } = args;
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };

	// Quem pagou: o próprio usuário, quem ele cuida, ou (administrador) qualquer membro. Nunca um uid do cliente sem conferir.
	const paidBy = input.paidByUid ?? uid;
	if (!canLaunchPaidBy(group.members, uid, paidBy)) {
		return { status: "invalid", field: "paidByUid", error: "Você só pode lançar despesas pagas por você, por quem você cuida ou, se for administrador, por alguém do grupo." };
	}
	// Só o administrador lançando por OUTRA pessoa pode deixar a chave Pix para depois; nos demais casos ela é exigida.
	const onBehalf = paidBy !== uid && !actsFor(group.members, uid, paidBy);
	const found = await payerPix(db, group, paidBy);
	let pix: ExpenseDoc["pix"];
	if (found) pix = found;
	else if (onBehalf) pix = undefined;
	else if (paidBy === uid) return { status: "no_pix" };
	else return { status: "no_pix", name: group.members.find((m) => m.uid === paidBy)?.name?.trim() || "Participante" };

	const memberUids = new Set(group.members.map((m) => m.uid));
	if (!input.participantUids.every((p) => memberUids.has(p))) {
		return { status: "invalid", field: "participantUids", error: "Escolha apenas pessoas que estão no grupo." };
	}

	let split: { uid: string; amountCents: number }[];
	try {
		split = splitEqually(input.amountCents, input.participantUids, paidBy);
	} catch {
		return { status: "invalid", field: "amountCents", error: "Esse valor é pequeno demais para dividir entre tantas pessoas." };
	}

	const count = input.installments?.count ?? 1;
	const ids = Array.from({ length: count }, () => new ObjectId());
	const uploaded: AttachmentMeta[] = [];
	let inserted = false;
	try {
		// Uma só cópia de cada arquivo no armazenamento; todas as parcelas apontam para as mesmas chaves.
		for (const f of files) {
			uploaded.push(
				await putAttachment(store, {
					groupId,
					expenseId: ids[0].toHexString(),
					bytes: f.bytes,
					name: f.name,
					contentType: f.contentType,
				}),
			);
		}
		const nowDate = new Date();
		const seriesId = count > 1 ? randomId() : null;
		const dueDates = input.dueDate ? installmentDueDates(input.dueDate, count) : [];
		const docs: ExpenseDoc[] = ids.map((_id, i) => ({
			_id,
			groupId: new ObjectId(groupId),
			createdBy: uid,
			paidBy,
			description: input.description,
			amountCents: input.amountCents,
			date: input.date,
			...(pix ? { pix: { ...pix } } : {}),
			shares: split.map((s) => ({ uid: s.uid, amountCents: s.amountCents, paidCents: 0 })),
			version: 0,
			attachments: uploaded.map((a) => ({ ...a })),
			...(input.dueDate ? { dueDate: dueDates[i] } : {}),
			...(seriesId ? { installment: { seriesId, number: i + 1, count } } : {}),
			createdAt: nowDate,
			updatedAt: nowDate,
		}));
		inserted = true;
		if (docs.length === 1) await expensesCollection(db).insertOne(docs[0]);
		else await expensesCollection(db).insertMany(docs, { ordered: true });
		return { status: "ok", expense: await toDetail(db, docs[0], group, uid, now, docs) };
	} catch (err) {
		// Falhou depois dos uploads (ou durante): não deixa parcelas pela metade nem arquivos órfãos.
		if (inserted) {
			try {
				await expensesCollection(db).deleteMany({ _id: { $in: ids }, groupId: new ObjectId(groupId) });
			} catch {
				console.error("createExpense rollback error");
			}
		}
		await deleteAttachments(store, uploaded.map((a) => a.key));
		throw err;
	}
}

// ---------- lista ----------

export type ExpenseListItem = {
	id: string;
	description: string;
	amountCents: number;
	date: string;
	paidBy: { uid: string; name: string; isYou: boolean; youManage: boolean };
	yourShareCents: number;
	yourStatus: ShareStatus | "none";
	yourDueCents: number;
	yourRefundCents: number;
	pendingCount: number;
	refundCount: number;
	attachmentCount: number;
	/** Cotas (que não são do dono) das pessoas sem login que o usuário cuida. */
	managed: { uid: string; name: string; status: ShareStatus; dueCents: number; refundCents: number }[];
	/** Só quando o usuário age pelo dono (dono sem login): situação de quem cobra. */
	ownerView: { pendingCount: number; refundCount: number } | null;
	dueDate: string | null;
	installment: InstallmentInfo | null;
	recurrence: RecurrenceRef | null;
	overdue: boolean;
	/** Sem valor a receber nem a devolver para ninguém. */
	settled: boolean;
	canHelp: boolean;
	ownerAlone: boolean;
	helpShareCents: number | null;
};

export const LIST_LIMIT = 300;

/** cota ainda não acertada (deve ou tem a receber/devolver), lendo o modelo antigo (status) quando não há paidCents */
const SHARE_PAID = {
	$cond: [{ $isNumber: "$$s.paidCents" }, "$$s.paidCents", { $cond: [{ $eq: ["$$s.status", "paid"] }, "$$s.amountCents", 0] }],
};
/**
 * Em aberto primeiro (vencimento crescente; sem vencimento vale a data da compra), depois as quitadas (mais novas primeiro).
 * Feito no banco para que o limite não corte uma despesa em aberto antiga.
 */
const listPipeline = (groupId: ObjectId) => [
	{ $match: { groupId } },
	{
		$addFields: {
			_open: {
				$anyElementTrue: {
					$map: {
						input: "$shares",
						as: "s",
						in: { $and: [{ $ne: ["$$s.uid", "$paidBy"] }, { $ne: [SHARE_PAID, "$$s.amountCents"] }] },
					},
				},
			},
		},
	},
	{ $addFields: { _rank: { $cond: ["$_open", 0, 1] }, _asc: { $cond: ["$_open", { $ifNull: ["$dueDate", "$date"] }, ""] } } },
	{ $sort: { _rank: 1, _asc: 1, date: -1, createdAt: -1, _id: -1 } },
	{ $limit: LIST_LIMIT },
	{ $unset: ["_open", "_rank", "_asc"] },
];

/** null se o grupo não existe ou `uid` não é membro. */
export async function listExpenses(db: Db, groupId: string, uid: string, now: Date = new Date()): Promise<ExpenseListItem[] | null> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return null;
	await materializeSafely(db, [group._id], now);
	const today = todayInSaoPaulo(now);
	const docs = await expensesCollection(db).aggregate<ExpenseDoc>(listPipeline(new ObjectId(groupId))).toArray();
	const people = await loadPeople(db, [...new Set(docs.map((d) => d.paidBy))]);
	const dir = directory(group, people, uid);
	return docs.map((raw) => {
		const d = { ...raw, shares: normalizeShares(raw.shares) };
		const mine = d.shares.find((s) => s.uid === uid);
		const pendingCount = d.shares.filter((s) => dueCents(s, d.paidBy) > 0).length;
		const refundCount = d.shares.filter((s) => refundCents(s, d.paidBy) > 0).length;
		return {
			id: d._id.toHexString(),
			description: d.description,
			amountCents: d.amountCents,
			date: d.date,
			paidBy: { uid: d.paidBy, name: dir.name(d.paidBy), isYou: d.paidBy === uid, youManage: dir.youManage(d.paidBy) },
			yourShareCents: mine?.amountCents ?? 0,
			yourStatus: mine ? shareStatus(mine, d.paidBy) : d.paidBy === uid ? "payer" : "none",
			yourDueCents: mine ? dueCents(mine, d.paidBy) : 0,
			yourRefundCents: mine ? refundCents(mine, d.paidBy) : 0,
			pendingCount,
			refundCount,
			attachmentCount: d.attachments.length,
			managed: d.shares
				.filter((s) => s.uid !== d.paidBy && dir.youManage(s.uid) && (s.amountCents > 0 || refundCents(s, d.paidBy) > 0))
				.map((s) => ({
					uid: s.uid,
					name: dir.name(s.uid),
					status: shareStatus(s, d.paidBy),
					dueCents: dueCents(s, d.paidBy),
					refundCents: refundCents(s, d.paidBy),
				})),
			ownerView: dir.youManage(d.paidBy) ? { pendingCount, refundCount } : null,
			dueDate: d.dueDate ?? null,
			installment: d.installment ?? null,
			recurrence: d.recurrence ?? null,
			overdue: isOverdue(d, today),
			settled: fullySettled(d),
			...(({ canHelp, ownerAlone, helpShareCents }) => ({ canHelp, ownerAlone, helpShareCents }))(helpInfo(d, group.members, uid)),
		};
	});
}

// ---------- anexo ----------

export type AttachmentRef =
	| { status: "ok"; key: string; name: string; contentType: string }
	| { status: "not_found" };

export async function getAttachmentRef(db: Db, groupId: string, eid: string, aid: string, uid: string): Promise<AttachmentRef> {
	if (!ATTACHMENT_ID_RE.test(aid)) return { status: "not_found" };
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "not_found" };
	const e = await findExpense(db, groupId, eid);
	const a = e?.attachments.find((x) => x.id === aid);
	if (!a) return { status: "not_found" };
	return { status: "ok", key: a.key, name: a.name, contentType: a.contentType };
}

export type ReceiptRef = { status: "ok"; key: string; name: string; contentType: string } | { status: "not_found" };

/** Comprovante da cota de `targetUid`: só para quem age por ela, por quem pagou a despesa, ou administra o grupo. */
export async function getReceiptRef(db: Db, groupId: string, eid: string, targetUid: string, uid: string, kind: "payment" | "refund" = "payment"): Promise<ReceiptRef> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "not_found" };
	const e = await findExpense(db, groupId, eid);
	const share = e?.shares.find((s) => s.uid === targetUid);
	const r = kind === "refund" ? share?.refund?.receipt : share?.receipt;
	if (!e || !r) return { status: "not_found" };
	// Vê o comprovante: a própria pessoa (ou quem age por ela), quem pagou a despesa e o administrador do grupo.
	if (!actsFor(group.members, uid, targetUid) && expenseRole(group.members, uid, e.paidBy) === null) return { status: "not_found" };
	return { status: "ok", key: r.key, name: r.name, contentType: r.contentType };
}

// ---------- apagar ----------

export type DeleteResult =
	| { status: "ok"; deleted: number; kept: number }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "has_payment" };

/** Filtro atômico: nenhuma cota com pagamento (quem pagou tem sempre paidCents 0; o modelo antigo `status: 'paid'` também conta). */
const NO_PAYMENTS = {
	shares: { $not: { $elemMatch: { $or: [{ paidCents: { $gt: 0 } }, { status: "paid" }, { refund: { $exists: true } }, { receipt: { $exists: true } }] } } },
};

/**
 * Apaga do armazenamento só os objetos que nenhuma despesa restante referencia (parcelas compartilham anexos).
 * Chamar DEPOIS de apagar os documentos: dois apagamentos concorrentes da última referência nunca deixam órfão
 * (o segundo a olhar não vê mais o outro) e apagar o mesmo objeto duas vezes é inofensivo.
 */
async function releaseAttachments(db: Db, store: AttachmentStore, keys: string[]): Promise<void> {
	const unique = [...new Set(keys)];
	if (unique.length === 0) return;
	const still = await expensesCollection(db)
		.find({ "attachments.key": { $in: unique } }, { projection: { attachments: 1 } })
		.toArray();
	const referenced = new Set(still.flatMap((d) => d.attachments.map((a) => a.key)));
	await deleteAttachments(
		store,
		unique.filter((k) => !referenced.has(k)),
	);
}

/**
 * Apaga do armazenamento só os comprovantes que nenhuma cota restante referencia (um comprovante de lote é
 * compartilhado por várias cotas, até de outras despesas). Chamar DEPOIS de gravar a mudança nas cotas.
 */
export async function releaseReceipts(db: Db, store: AttachmentStore, keys: string[]): Promise<void> {
	const unique = [...new Set(keys)];
	if (unique.length === 0) return;
	const still = await expensesCollection(db)
		.find(
			{ $or: [{ "shares.receipt.key": { $in: unique } }, { "shares.refund.receipt.key": { $in: unique } }] },
			{ projection: { "shares.receipt.key": 1, "shares.refund.receipt.key": 1 } },
		)
		.toArray();
	const referenced = new Set(still.flatMap((d) => d.shares.flatMap(receiptKeysOfShare)));
	await deleteAttachments(
		store,
		unique.filter((k) => !referenced.has(k)),
	);
}

/**
 * `scope: 'following'` apaga esta parcela e as seguintes da série que não têm pagamento; as que têm ficam (`kept`).
 * A parcela pedida precisa poder ser apagada (sem pagamento), como no apagamento simples.
 */
export async function deleteExpense(
	db: Db,
	store: AttachmentStore,
	groupId: string,
	eid: string,
	uid: string,
	scope: ParticipantsScope = "this",
): Promise<DeleteResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const e = await findExpense(db, groupId, eid);
	if (!e) return { status: "no_expense" };
	const allowed = (x: { paidBy: string }) => expenseRole(group.members, uid, x.paidBy) !== null;
	if (!allowed(e)) return { status: "forbidden" };
	if (hasPayments(e)) return { status: "has_payment" };

	if (scope === "this" || !e.installment) {
		// Condicional: se um pagamento entrar no meio do caminho, não apaga.
		const res = await expensesCollection(db).deleteOne({ _id: e._id, groupId: e.groupId, ...NO_PAYMENTS });
		if (res.deletedCount === 0) {
			return (await findExpense(db, groupId, eid)) ? { status: "has_payment" } : { status: "no_expense" };
		}
		await releaseAttachments(db, store, e.attachments.map((a) => a.key));
		await releaseReceipts(db, store, receiptKeysOf(e));
		return { status: "ok", deleted: 1, kept: 0 };
	}

	const targets = (await followingOf(db, e)).filter(allowed);
	const ids = targets.map((t) => t._id);
	// Um só deleteMany com o mesmo filtro atômico por documento: parcela que recebeu pagamento no meio do caminho fica.
	const res = await expensesCollection(db).deleteMany({ _id: { $in: ids }, groupId: e.groupId, ...NO_PAYMENTS });
	if (res.deletedCount === 0) {
		return (await findExpense(db, groupId, eid)) ? { status: "has_payment" } : { status: "no_expense" };
	}
	await releaseAttachments(db, store, targets.flatMap((t) => t.attachments.map((a) => a.key)));
	// Só o que nenhuma cota restante referencia é apagado (parcelas que ficaram e outros lotes mantêm o objeto).
	await releaseReceipts(db, store, targets.flatMap(receiptKeysOf));
	return { status: "ok", deleted: res.deletedCount, kept: targets.length - res.deletedCount };
}

const receiptKeysOf = (e: { shares: ExpenseShare[] }): string[] => e.shares.flatMap(receiptKeysOfShare);

/** Esta parcela e as seguintes da mesma série, em ordem (normalizadas). */
async function followingOf(db: Db, e: ExpenseDoc): Promise<ExpenseDoc[]> {
	if (!e.installment) return [e];
	const docs = await expensesCollection(db)
		.find({ groupId: e.groupId, "installment.seriesId": e.installment.seriesId, "installment.number": { $gte: e.installment.number } })
		.sort({ "installment.number": 1 })
		.toArray();
	const list = docs.length ? docs : [e];
	return list.map((d) => ({ ...d, shares: normalizeShares(d.shares) }));
}

// ---------- alterar cotas (concorrência otimista) ----------

const CONFLICT_RETRIES = 1;
const versionFilter = (e: ExpenseDoc) => (e.version === undefined ? { version: { $exists: false } } : { version: e.version });

/** `set`/`unset`: outros campos da despesa gravados junto com as cotas, na mesma escrita (e na mesma checagem de versão). */
export type Mutation = (
	e: ExpenseDoc,
) => { shares: ExpenseShare[]; changed: boolean; set?: Partial<Omit<ExpenseDoc, "_id">>; unset?: "dueDate"[] } | { error: unknown };
export type Mutated =
	| { kind: "ok"; doc: ExpenseDoc; before: ExpenseDoc; wrote: boolean }
	| { kind: "no_expense" }
	| { kind: "conflict" }
	| { kind: "rejected"; error: unknown };

/**
 * Lê a despesa, calcula as novas cotas e grava só se a `version` lida ainda for a atual.
 * Se perder a corrida, relê e tenta mais uma vez; depois disso, "conflict".
 */
export async function mutateShares(db: Db, groupId: string, eid: string, mutate: Mutation): Promise<Mutated> {
	if (!isObjectIdHex(eid)) return { kind: "no_expense" };
	for (let attempt = 0; attempt <= CONFLICT_RETRIES; attempt++) {
		const e = await findExpense(db, groupId, eid);
		if (!e) return { kind: "no_expense" };
		const m = mutate(e);
		if ("error" in m) return { kind: "rejected", error: m.error };
		if (!m.changed) return { kind: "ok", doc: e, before: e, wrote: false };
		const now = new Date();
		const res = await expensesCollection(db).updateOne(
			{ _id: e._id, groupId: e.groupId, paidBy: e.paidBy, ...versionFilter(e) },
			{
				$set: { ...m.set, shares: m.shares, updatedAt: now },
				...(m.unset?.length ? { $unset: Object.fromEntries(m.unset.map((k) => [k, ""])) } : {}),
				$inc: { version: 1 },
			},
		);
		if (res.matchedCount > 0) {
			const doc: ExpenseDoc = { ...e, ...m.set, shares: m.shares, version: (e.version ?? 0) + 1, updatedAt: now };
			for (const k of m.unset ?? []) delete doc[k];
			return { kind: "ok", doc, before: e, wrote: true };
		}
	}
	return { kind: "conflict" };
}

// ---------- quitar / desfazer ----------

export type MarkShareResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "no_share" }
	| { status: "conflict" };

/**
 * Quem pagou a despesa, ou o administrador do grupo, quita (paid) ou desfaz (pending) a cota de outra pessoa. "Quitar" vale tanto para
 * receber o que falta quanto para devolver um reembolso. Idempotente.
 */
export async function setSharePaid(
	db: Db,
	groupId: string,
	eid: string,
	uid: string,
	targetUid: string,
	status: "paid" | "pending",
	now: Date = new Date(),
	store?: AttachmentStore,
): Promise<MarkShareResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const r = await mutateShares(db, groupId, eid, (e) => {
		const role = expenseRole(group.members, uid, e.paidBy);
		if (!role) return { error: "forbidden" };
		const change = status === "paid" ? settleShare(e.shares, e.paidBy, targetUid, new Date(), uid, role === "admin") : undoShare(e.shares, e.paidBy, targetUid);
		return change ?? { error: "no_share" };
	});
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") return { status: r.error === "forbidden" ? "forbidden" : "no_share" };
	if (store && r.wrote) await releaseReceipts(db, store, droppedReceiptKeys(r.before.shares, r.doc.shares));
	return { status: "ok", expense: await toDetail(db, r.doc, group, uid, now) };
}

// ---------- "Devolvi" (com comprovante opcional) ----------

/**
 * Quem pagou a despesa (ou quem age por ele), ou o administrador do grupo, marca que a devolução à pessoa foi feita,
 * com comprovante opcional. O comprovante da devolução é outro documento: o do pagamento original continua na cota.
 * O arquivo só sobe depois de validar a permissão e é apagado se nada for gravado. Idempotente.
 */
export async function refundShare(
	db: Db,
	store: AttachmentStore,
	args: { groupId: string; eid: string; uid: string; targetUid: string; file?: SniffedFile; now?: Date },
): Promise<MarkShareResult> {
	const { groupId, eid, uid, targetUid, file } = args;
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const current = await findExpense(db, groupId, eid);
	if (!current) return { status: "no_expense" };
	const role = expenseRole(group.members, uid, current.paidBy);
	if (!role) return { status: "forbidden" };
	const target = current.shares.find((s) => s.uid === targetUid);
	if (!target || target.uid === current.paidBy) return { status: "no_share" };
	if (target.paidCents <= target.amountCents) {
		// Segundo toque em "Devolvi": já devolvida, é sucesso sem gravar nada (e sem subir outro comprovante).
		if (target.refund) return { status: "ok", expense: await toDetail(db, current, group, uid, now) };
		return { status: "no_share" };
	}

	const receipt = file
		? await putReceipt(store, { groupId, expenseId: current._id.toHexString(), bytes: file.bytes, name: file.name, contentType: file.contentType })
		: undefined;
	let r: Mutated;
	try {
		r = await mutateShares(db, groupId, eid, (x) => {
			if (!expenseRole(group.members, uid, x.paidBy)) return { error: "forbidden" };
			// Confere de novo com a despesa lida AGORA: se alguém mexeu no meio do caminho, nunca quita uma parte pendente por engano.
			const t = x.shares.find((y) => y.uid === targetUid);
			if (!t || t.uid === x.paidBy) return { error: "no_share" };
			if (t.paidCents === t.amountCents && t.refund) return { shares: x.shares, changed: false }; // já devolvida (idempotente)
			if (t.paidCents <= t.amountCents) return { error: "no_share" };
			return settleShare(x.shares, x.paidBy, targetUid, now, uid, role === "admin", receipt) ?? { error: "no_share" };
		});
	} catch (err) {
		if (receipt) await deleteAttachments(store, [receipt.key]);
		throw err;
	}
	if (receipt && !(r.kind === "ok" && r.wrote)) await deleteAttachments(store, [receipt.key]);
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") return { status: r.error === "forbidden" ? "forbidden" : "no_share" };
	if (r.wrote) await releaseReceipts(db, store, droppedReceiptKeys(r.before.shares, r.doc.shares));
	return { status: "ok", expense: await toDetail(db, r.doc, group, uid, now) };
}

// ---------- "já paguei" (a própria pessoa) ----------

export type SelfPayResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "no_share" }
	| { status: "conflict" };

/**
 * Quem deve (ou quem age por essa pessoa) avisa que pagou, com comprovante opcional. Cota pendente vira quitada
 * (`method: "self"`); cota já quitada só recebe/troca o comprovante. O arquivo vai ao armazenamento só depois de
 * validar a permissão e é apagado se a gravação falhar; o comprovante substituído é apagado depois da gravação.
 */
export async function markSelfPaid(
	db: Db,
	store: AttachmentStore,
	args: { groupId: string; eid: string; uid: string; targetUid: string; file?: SniffedFile; now?: Date },
): Promise<SelfPayResult> {
	const { groupId, eid, uid, targetUid, file } = args;
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const current = await findExpense(db, groupId, eid);
	if (!current) return { status: "no_expense" };
	if (!actsFor(group.members, uid, targetUid)) return { status: "forbidden" };
	if (payShare(current.shares, current.paidBy, targetUid, now, uid) === null) return { status: "no_share" };

	const receipt = file
		? await putReceipt(store, { groupId, expenseId: current._id.toHexString(), bytes: file.bytes, name: file.name, contentType: file.contentType })
		: undefined;
	let r: Mutated;
	try {
		r = await mutateShares(db, groupId, eid, (e) => payShare(e.shares, e.paidBy, targetUid, now, uid, receipt) ?? { error: "no_share" });
	} catch (err) {
		if (receipt) await deleteAttachments(store, [receipt.key]);
		throw err;
	}
	if (receipt && !(r.kind === "ok" && r.wrote)) await deleteAttachments(store, [receipt.key]);
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") return { status: "no_share" };
	if (r.wrote) await releaseReceipts(db, store, droppedReceiptKeys(r.before.shares, r.doc.shares));
	return { status: "ok", expense: await toDetail(db, r.doc, group, uid, now) };
}

// ---------- mudar quem divide ----------

export type UpdateParticipantsResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "invalid"; error: string; field: string }
	| { status: "conflict" };

/**
 * Refaz a divisão do total entre `participantUids`, sem perder o que já foi pago (ver `recalcShares`).
 *
 * `scope: 'following'` aplica a mesma lista a esta parcela e às seguintes da série. Garantias:
 * 1. Tudo é validado ANTES de qualquer escrita (permissão, membros, valor divisível em cada parcela): erro de
 *    validação nunca deixa estado parcial.
 * 2. Cada parcela é gravada com a sua própria checagem de `version` (uma nova tentativa por parcela).
 * 3. Se alguma parcela ainda assim perder a corrida, as já gravadas voltam às cotas anteriores (condicionado a
 *    ninguém ter mexido nelas desde a gravação) e a chamada falha com `conflict`. Só uma escrita concorrente
 *    nas mesmas parcelas durante esse desfazer pode deixar um estado parcial.
 */
export async function updateParticipants(
	db: Db,
	groupId: string,
	eid: string,
	uid: string,
	participantUids: string[],
	scope: ParticipantsScope = "this",
	now: Date = new Date(),
	store?: AttachmentStore,
): Promise<UpdateParticipantsResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };

	const memberUids = new Set(group.members.map((m) => m.uid));
	const mutation: Mutation = (e) => {
		if (!expenseRole(group.members, uid, e.paidBy)) return { error: { status: "forbidden" } };
		if (participantUids.length === 0 || new Set(participantUids).size !== participantUids.length) {
			return { error: { status: "invalid", field: "participantUids", error: "Escolha quem divide a despesa." } };
		}
		if (!participantUids.every((p) => memberUids.has(p))) {
			return { error: { status: "invalid", field: "participantUids", error: "Escolha apenas pessoas que estão no grupo." } };
		}
		try {
			return { shares: recalcShares(e.shares, e.paidBy, e.amountCents, participantUids), changed: true };
		} catch {
			return {
				error: { status: "invalid", field: "amountCents", error: "Esse valor é pequeno demais para dividir entre tantas pessoas." },
			};
		}
	};
	const rejection = (error: unknown) => error as { status: "forbidden" } | { status: "invalid"; error: string; field: string };

	if (scope === "this") {
		const r = await mutateShares(db, groupId, eid, mutation);
		if (r.kind === "no_expense") return { status: "no_expense" };
		if (r.kind === "conflict") return { status: "conflict" };
		if (r.kind === "rejected") return rejection(r.error);
		if (store && r.wrote) await releaseReceipts(db, store, droppedReceiptKeys(r.before.shares, r.doc.shares));
		return { status: "ok", expense: await toDetail(db, r.doc, group, uid, now) };
	}

	const first = await findExpense(db, groupId, eid);
	if (!first) return { status: "no_expense" };
	const targets = await followingOf(db, first);
	// 1. valida todas antes de escrever qualquer uma
	for (const t of targets) {
		const m = mutation(t);
		if ("error" in m) return rejection(m.error);
	}
	// 2. grava em ordem; 3. desfaz as já gravadas se uma falhar
	const written: { before: ExpenseDoc; doc: ExpenseDoc }[] = [];
	let failure: UpdateParticipantsResult | null = null;
	for (const t of targets) {
		const r = await mutateShares(db, groupId, t._id.toHexString(), mutation);
		if (r.kind === "ok") {
			if (r.wrote) written.push({ before: r.before, doc: r.doc });
			continue;
		}
		failure = r.kind === "conflict" ? { status: "conflict" } : r.kind === "no_expense" ? { status: "conflict" } : rejection(r.error);
		break;
	}
	if (failure) {
		for (const w of written.reverse()) {
			try {
				await expensesCollection(db).updateOne(
					{ _id: w.doc._id, groupId: w.doc.groupId, version: w.doc.version },
					{ $set: { shares: w.before.shares, updatedAt: new Date() }, $inc: { version: 1 } },
				);
			} catch {
				console.error("updateParticipants rollback error");
			}
		}
		return failure;
	}
	// Quem saiu da divisão sem ter pago perde só a cota; comprovante só some junto com a cota inteira.
	if (store) await releaseReceipts(db, store, written.flatMap((w) => droppedReceiptKeys(w.before.shares, w.doc.shares)));
	const mine = written.find((w) => w.doc._id.equals(first._id))?.doc ?? first;
	return { status: "ok", expense: await toDetail(db, mine, group, uid, now) };
}

// ---------- editar a despesa ----------

export type EditExpenseResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	| { status: "forbidden" }
	| { status: "invalid"; error: string; field: string }
	| { status: "conflict" };

const sameSplit = (a: ExpenseShare[], b: ExpenseShare[]) =>
	a.length === b.length && a.every((x) => b.some((y) => y.uid === x.uid && y.amountCents === x.amountCents));

/**
 * Edita descrição, valor, data, vencimento e quem divide. Quem pagou a despesa ou o administrador do grupo pode.
 * As cotas são refeitas por `recalcShares` (a mesma regra de "Mudar quem divide"): o que cada um já pagou e os
 * comprovantes ficam; quem pagou a mais passa a ter reembolso (`refundCents`) e quem saiu da divisão depois de pagar
 * fica com cota 0 e o pago como reembolso. Tudo numa só escrita com checagem de `version`.
 * Vale só para esta despesa (uma parcela não muda as outras). Quem pagou e a chave Pix não mudam.
 */
export async function editExpense(
	db: Db,
	store: AttachmentStore,
	args: { groupId: string; eid: string; uid: string; input: ExpenseEdit; now?: Date },
): Promise<EditExpenseResult> {
	const { groupId, eid, uid, input } = args;
	const now = args.now ?? new Date();
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const memberUids = new Set(group.members.map((m) => m.uid));
	const r = await mutateShares(db, groupId, eid, (e) => {
		if (!expenseRole(group.members, uid, e.paidBy)) return { error: { status: "forbidden" } };
		if (input.participantUids.length === 0 || new Set(input.participantUids).size !== input.participantUids.length) {
			return { error: { status: "invalid", field: "participantUids", error: "Escolha quem divide a despesa." } };
		}
		// Só quem está ENTRANDO na divisão precisa ser do grupo; quem já dividia e saiu do grupo pode continuar na divisão.
		const already = new Set(participantUidsOf(e.shares));
		if (!input.participantUids.every((p) => memberUids.has(p) || already.has(p))) {
			return { error: { status: "invalid", field: "participantUids", error: "Escolha apenas pessoas que estão no grupo." } };
		}
		// Vencimento antes da data: só barra quando a pessoa mexeu em uma das duas datas (despesas antigas podem ter essa combinação).
		if (input.dueDate && input.dueDate < input.date && (input.date !== e.date || input.dueDate !== e.dueDate)) {
			return { error: { status: "invalid", field: "dueDate", error: "O vencimento não pode ser antes da data da despesa." } };
		}
		if (e.installment && !input.dueDate) {
			return { error: { status: "invalid", field: "dueDate", error: "Uma parcela precisa de data de vencimento." } };
		}
		let shares: ExpenseShare[];
		try {
			shares = recalcShares(e.shares, e.paidBy, input.amountCents, input.participantUids);
		} catch {
			return { error: { status: "invalid", field: "amountCents", error: "Esse valor é pequeno demais para dividir entre tantas pessoas." } };
		}
		const splitSame = sameSplit(e.shares, shares);
		const changed =
			e.description !== input.description ||
			e.amountCents !== input.amountCents ||
			e.date !== input.date ||
			(e.dueDate ?? null) !== (input.dueDate ?? null) ||
			!splitSame;
		return {
			shares: splitSame ? e.shares : shares,
			changed,
			set: { description: input.description, amountCents: input.amountCents, date: input.date, ...(input.dueDate ? { dueDate: input.dueDate } : {}) },
			...(input.dueDate ? {} : { unset: ["dueDate" as const] }),
		};
	});
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") return r.error as { status: "forbidden" } | { status: "invalid"; error: string; field: string };
	if (r.wrote) await releaseReceipts(db, store, droppedReceiptKeys(r.before.shares, r.doc.shares));
	return { status: "ok", expense: await toDetail(db, r.doc, group, uid, now) };
}

// ---------- quero ajudar ----------

export type HelpResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" }
	/** Quem pagou (ou quem age por quem pagou) não ajuda na própria despesa. */
	| { status: "payer" }
	| { status: "already"; name: string | null }
	| { status: "invalid"; error: string; field: string }
	| { status: "conflict" };

/**
 * Entra na divisão ("Quero ajudar"): o ajudante é `uid` ou, com `forUid`, uma pessoa sem login que `uid` cuida.
 * Divide o total igualmente entre quem já divide + o ajudante (regras de `recalcShares`) e marca a cota com
 * `helped`/`helpedAt`. Vale só para esta despesa (também em parcelas). Mesma concorrência otimista de
 * `updateParticipants`: uma nova tentativa e depois `conflict`.
 */
export async function helpExpense(
	db: Db,
	groupId: string,
	eid: string,
	uid: string,
	forUid?: string,
	now: Date = new Date(),
): Promise<HelpResult> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "no_group" };
	const helper = forUid ?? uid;
	const forOther = helper !== uid;
	if (forOther && (!isManagedMember(group.members, helper) || !actsFor(group.members, uid, helper))) {
		return { status: "invalid", field: "forUid", error: "Você só pode ajudar por quem você cuida." };
	}
	const r = await mutateShares(db, groupId, eid, (e) => {
		if (helper === e.paidBy || actsFor(group.members, helper, e.paidBy)) return { error: { status: "payer" } };
		if (e.shares.some((s) => s.uid === helper && s.amountCents > 0)) return { error: { status: "already" } };
		try {
			return { shares: addHelper(e.shares, e.paidBy, e.amountCents, helper, now), changed: true };
		} catch {
			return { error: { status: "invalid", field: "amountCents", error: "Esse valor é pequeno demais para dividir entre tantas pessoas." } };
		}
	});
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") {
		const err = r.error as { status: "payer" } | { status: "already" } | { status: "invalid"; error: string; field: string };
		if (err.status === "already") {
			const name = forOther ? group.members.find((m) => m.uid === helper)?.name?.trim() || "Participante" : null;
			return { status: "already", name };
		}
		return err;
	}
	return { status: "ok", expense: await toDetail(db, r.doc, group, uid, now) };
}

// ---------- resumo ----------

export type Summary = Balance & {
	managed: ({ uid: string; name: string; groupId: string; groupName: string } & Balance)[];
};

/**
 * Os grupos (id, nome, membros) em que `uid` é membro AGORA; com `groupId`, só esse. Com `groupId` inválido ou de um
 * grupo de que `uid` não faz parte devolve `null` (a rota responde 404); sem `groupId` nunca é `null`.
 */
export async function memberGroupsOf(db: Db, uid: string, groupId?: string): Promise<Pick<GroupDoc, "_id" | "name" | "members">[] | null> {
	if (groupId !== undefined && !isObjectIdHex(groupId)) return null;
	const groups = await groupsCollection(db)
		.find(groupId === undefined ? { "members.uid": uid } : { _id: new ObjectId(groupId), "members.uid": uid }, {
			projection: { _id: 1, name: 1, members: 1 },
		})
		.toArray();
	return groupId !== undefined && groups.length === 0 ? null : groups;
}

/**
 * Só grupos em que `uid` é membro AGORA. Os totais são estritamente os de `uid` (a mesma conta de GET /api/groups);
 * `managed` traz o saldo de cada pessoa sem login pela qual `uid` é responsável AGORA. Uma única agregação.
 * Todo campo do topo é a soma dos campos dos grupos.
 * Com `groupId`, a mesma conta restrita a esse grupo (o que o início mostra, só dele); `null` se `uid` não é membro.
 */
export async function getSummary(db: Db, uid: string, now?: Date): Promise<Summary>;
export async function getSummary(db: Db, uid: string, now: Date | undefined, groupId: string): Promise<Summary | null>;
export async function getSummary(db: Db, uid: string, now: Date = new Date(), groupId?: string): Promise<Summary | null> {
	const groups = await memberGroupsOf(db, uid, groupId);
	if (!groups) return null;
	await materializeSafely(db, groups.map((g) => g._id), now);
	const managedList = groups.flatMap((g) =>
		g.members
			.filter((m) => m.kind === "managed" && m.managedBy === uid)
			.map((m) => ({ uid: m.uid, name: m.name?.trim() || "Participante", groupId: g._id.toHexString(), groupName: g.name })),
	);
	const balances = await getBalancesForUids(
		db,
		[uid, ...new Set(managedList.map((m) => m.uid))],
		groups.map((g) => g._id),
		now,
	);
	return {
		...sumBalances(groups.map((g) => balances.get(`${g._id.toHexString()}:${uid}`) ?? ZERO_BALANCE)),
		managed: managedList.map((m) => ({ ...m, ...(balances.get(`${m.groupId}:${m.uid}`) ?? ZERO_BALANCE) })),
	};
}

// ---------- resumo do grupo (para compartilhar) ----------

export const SUMMARY_DEBT_CAP = 100;
export const SUMMARY_NAMES_CAP = 30;

export type GroupSummaryView = {
	groupId: string;
	groupName: string;
	/** Soma de tudo o que ainda está em aberto no grupo (dívidas já compensadas entre cada dupla). */
	totalOpenCents: number;
	/** Parte do total que já venceu. */
	overdueCents: number;
	/** Quem deve a quem (só nomes: nunca chave Pix nem códigos de usuário). Limitado a `SUMMARY_DEBT_CAP`. */
	debts: { fromName: string; toName: string; cents: number; overdue: boolean; refund: boolean }[];
	/** Dívidas que não couberam em `debts`. */
	moreDebts: number;
	/** Quem não deve nada. Limitado a `SUMMARY_NAMES_CAP`. */
	upToDate: string[];
	moreUpToDate: number;
	/** Havia despesas em aberto demais: os totais e a lista de quem está em dia NÃO são confiáveis (o texto avisa). */
	partial: boolean;
	/** Despesas com algo em aberto (as mais urgentes primeiro), limitadas a `SUMMARY_EXPENSE_CAP`. Só nomes e valores. */
	expenses: OpenExpense[];
	/** Despesas em aberto que não couberam em `expenses`. */
	moreExpenses: number;
	/** Partes a pagar com vencimento de hoje até daqui a 15 dias, por vencimento. */
	upcoming: UpcomingPayment[];
	moreUpcoming: number;
	/** Soma de TODAS as partes do período (inclusive as cortadas de `upcoming`). */
	upcomingTotalCents: number;
};

export const SUMMARY_DOC_LIMIT = 5000;
export const SUMMARY_EXPENSE_CAP = 40;
export const SUMMARY_UPCOMING_CAP = 30;

/** Próximo mês de cada despesa fixa que cai nos próximos 15 dias e ainda não virou despesa (só o modelo mensal existe). */
async function templatesInWindow(db: Db, group: GroupDoc, today: string, now: Date): Promise<OpenSource[]> {
	const recs = await recurrencesCollection(db).find({ groupId: group._id, active: true }).toArray();
	const current = currentPeriod(now);
	const end = addDays(today, UPCOMING_DAYS);
	const out: OpenSource[] = [];
	for (const r of recs) {
		// Só vale o mês SEGUINTE em diante: o de hoje (ou antes) já foi gerado pela leitura, mesmo sem chave Pix (nasce sem cópia da chave).
		// Se a geração falhou, não se projeta nada.
		if (r.nextPeriod <= current || (r.endPeriod && r.nextPeriod > r.endPeriod)) continue;
		if (!group.members.some((m) => m.uid === r.paidBy)) continue;
		const due = dueDateFor(r.nextPeriod, r.dayOfMonth);
		if (due < today || due > end) continue;
		const e = buildRecurringExpense(r, group, r.nextPeriod, null, now);
		out.push({ _id: `modelo-${r._id.toHexString()}`, paidBy: e.paidBy, shares: e.shares, dueDate: e.dueDate, description: e.description, amountCents: e.amountCents, date: e.date, fromTemplate: true });
	}
	return out;
}

/** O mesmo resumo para qualquer membro (não é o saldo pessoal de quem pede). null se o grupo não existe ou `uid` não é membro. */
export async function getGroupSummary(db: Db, groupId: string, uid: string, now: Date = new Date()): Promise<GroupSummaryView | null> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return null;
	await materializeSafely(db, [group._id], now);
	const docs = await expensesCollection(db)
		.aggregate<Pick<ExpenseDoc, "_id" | "paidBy" | "shares" | "dueDate" | "description" | "amountCents" | "date" | "installment" | "recurrence">>([
			{ $match: { groupId: group._id } },
			{
				$match: {
					$expr: {
						$anyElementTrue: {
							$map: { input: "$shares", as: "s", in: { $and: [{ $ne: ["$$s.uid", "$paidBy"] }, { $ne: [SHARE_PAID, "$$s.amountCents"] }] } },
						},
					},
				},
			},
			{ $project: { paidBy: 1, shares: 1, dueDate: 1, description: 1, amountCents: 1, date: 1, installment: 1, recurrence: 1 } },
			{ $sort: { _id: 1 } },
			{ $limit: SUMMARY_DOC_LIMIT + 1 },
		])
		.toArray();
	const partial = docs.length > SUMMARY_DOC_LIMIT;
	const usable = partial ? docs.slice(0, SUMMARY_DOC_LIMIT) : docs;
	const today = todayInSaoPaulo(now);
	const debts = groupDebts(usable, today);
	const people = await loadPeople(db, group.members.map((m) => m.uid));
	const dir = directory(group, people, uid);
	const debtors = new Set(debts.map((d) => d.fromUid));
	const names = group.members.filter((m) => !debtors.has(m.uid)).map((m) => dir.name(m.uid));
	names.sort((a, b) => a.localeCompare(b, "pt-BR"));
	let templates: OpenSource[] = [];
	try {
		templates = await templatesInWindow(db, group, today, now);
	} catch (err) {
		console.error("templatesInWindow error:", describeError(err));
	}
	const lists = buildOpenLists([...usable, ...templates], today, dir.name, { maxExpenses: SUMMARY_EXPENSE_CAP, maxUpcoming: SUMMARY_UPCOMING_CAP });
	return {
		groupId: group._id.toHexString(),
		groupName: group.name,
		totalOpenCents: debts.reduce((t, d) => t + d.cents, 0),
		overdueCents: debts.reduce((t, d) => t + d.overdueCents, 0),
		debts: debts.slice(0, SUMMARY_DEBT_CAP).map((d) => ({ fromName: dir.name(d.fromUid), toName: dir.name(d.toUid), cents: d.cents, overdue: d.overdueCents > 0, refund: d.kind === "refund" })),
		moreDebts: Math.max(0, debts.length - SUMMARY_DEBT_CAP),
		upToDate: names.slice(0, SUMMARY_NAMES_CAP),
		moreUpToDate: Math.max(0, names.length - SUMMARY_NAMES_CAP),
		partial,
		expenses: lists.expenses,
		moreExpenses: Math.max(0, lists.expenseCount - lists.expenses.length),
		upcoming: lists.upcoming,
		moreUpcoming: Math.max(0, lists.upcomingCount - lists.upcoming.length),
		upcomingTotalCents: lists.upcomingTotalCents,
	};
}
