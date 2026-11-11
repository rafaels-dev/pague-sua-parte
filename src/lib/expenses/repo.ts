import { ObjectId, type Db } from "mongodb";
import { groupsCollection, type GroupDoc } from "@/lib/groups/repo";
import { actsFor, isManagedMember, isManagedUid, isObjectIdHex } from "@/lib/groups/helpers";
import type { PixKey } from "@/lib/pix/key";
import {
	deleteAttachments,
	putAttachment,
	putReceipt,
	randomId,
	type AttachmentMeta,
	type AttachmentStore,
} from "@/lib/storage/attachments";
import { usersCollection, type UserDoc } from "@/lib/users/repo";
import { getBalancesForUids, sumBalances, ZERO_BALANCE } from "./balances";
import { installmentDueDates, isPastDue, todayInSaoPaulo } from "./dates";
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
import type { ExpenseInput, ParticipantsScope, SniffedFile } from "./validation";

export type { ExpenseShare, ShareMethod, ShareStatus } from "./shares";

export type ExpenseDoc = {
	_id: ObjectId;
	groupId: ObjectId;
	createdBy: string;
	paidBy: string;
	description: string;
	amountCents: number;
	date: string;
	pix: PixKey & { payeeName: string };
	shares: ExpenseShare[];
	/** Cresce a cada escrita em `shares` (concorrência otimista). Ausente em documentos antigos = 0. */
	version?: number;
	attachments: AttachmentMeta[];
	/** Vencimento (compra no cartão), YYYY-MM-DD. */
	dueDate?: string;
	/** Presente quando a despesa é uma parcela de uma série. */
	installment?: InstallmentInfo;
	createdAt: Date;
	updatedAt: Date;
};

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
	/** Quem lançou a despesa (paidBy) pode marcar as partes dos outros como pagas. */
	canMarkPaid: boolean;
	/** Só quem pagou pode mudar quem divide. */
	canEditParticipants: boolean;
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
	pix: { type: string; key: string; payeeName: string };
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
		/** Só para quem pode baixar (a pessoa, quem age por ela ou por quem pagou); null para os demais. */
		receipt: { name: string; contentType: string; size: number } | null;
		/** Você age por esta pessoa e a parte dela está pendente: pode avisar que pagou. */
		canPay: boolean;
		/** Você age por esta pessoa e ela já pagou o valor todo: pode anexar ou trocar o comprovante. */
		canAddReceipt: boolean;
	}[];
	attachments: { id: string; name: string; contentType: string; size: number }[];
	dueDate: string | null;
	installment: InstallmentInfo | null;
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
	const isAdmin = group.members.some((m) => m.uid === uid && m.role === "admin");
	return (actsFor(group.members, uid, e.paidBy) || isAdmin) && !hasPayments(e);
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

async function toDetail(db: Db, e: ExpenseDoc, group: GroupDoc, uid: string, now: Date, known?: ExpenseDoc[]): Promise<ExpenseDetail> {
	const people = await loadPeople(db, uidsToLoad(group, [...new Set([e.paidBy, ...e.shares.map((s) => s.uid)])]));
	const dir = directory(group, people, uid);
	const view = (u: string) => ({ uid: u, name: dir.name(u), picture: dir.picture(u), isYou: u === uid });
	const owns = actsFor(group.members, uid, e.paidBy);
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
		...helpInfo(e, group.members, uid),
		participantUids: participantUidsOf(e.shares),
		paidBy: { ...view(e.paidBy), kind: dir.kind(e.paidBy), youManage: dir.youManage(e.paidBy) },
		pix: { type: e.pix.type, key: e.pix.key, payeeName: e.pix.payeeName },
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
				receipt:
					s.receipt && (actsForShare || owns) ? { name: s.receipt.name, contentType: s.receipt.contentType, size: s.receipt.size } : null,
				canPay: actsForShare && status === "pending",
				canAddReceipt: actsForShare && s.uid !== e.paidBy && s.amountCents > 0 && s.paidCents === s.amountCents,
			};
		}),
		attachments: e.attachments.map((a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size })),
		dueDate: e.dueDate ?? null,
		installment: e.installment ?? null,
		overdue: isOverdue(e, todayInSaoPaulo(now)),
		series: await seriesOf(db, e, known),
	};
}

export type GetExpenseResult =
	| { status: "ok"; expense: ExpenseDetail }
	| { status: "no_group" }
	| { status: "no_expense" };

async function findExpense(db: Db, groupId: string, eid: string) {
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

	// Quem pagou: o próprio usuário ou uma pessoa sem login que ele cuida (nunca um uid vindo do cliente sem conferir).
	const paidBy = input.paidByUid ?? uid;
	let pix: ExpenseDoc["pix"];
	if (paidBy === uid) {
		const payer = await usersCollection(db).findOne({ _id: uid }, { projection: { name: 1, displayName: 1, pixKey: 1 } });
		if (!payer?.pixKey) return { status: "no_pix" };
		pix = { type: payer.pixKey.type, key: payer.pixKey.key, payeeName: personName(payer) };
	} else {
		if (!isManagedMember(group.members, paidBy) || !actsFor(group.members, uid, paidBy)) {
			return { status: "invalid", field: "paidByUid", error: "Você só pode lançar despesas pagas por você ou por quem você cuida." };
		}
		const managed = group.members.find((m) => m.uid === paidBy)!;
		const name = managed.name?.trim() || "Participante";
		if (!managed.pixKey) return { status: "no_pix", name };
		pix = { type: managed.pixKey.type, key: managed.pixKey.key, payeeName: name };
	}

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
			pix: { ...pix },
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
				.filter((s) => s.uid !== d.paidBy && dir.youManage(s.uid))
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

/** Comprovante da cota de `targetUid`: só para quem age por ela ou por quem pagou a despesa. */
export async function getReceiptRef(db: Db, groupId: string, eid: string, targetUid: string, uid: string): Promise<ReceiptRef> {
	const group = await findMemberGroup(db, groupId, uid);
	if (!group) return { status: "not_found" };
	const e = await findExpense(db, groupId, eid);
	const r = e?.shares.find((s) => s.uid === targetUid)?.receipt;
	if (!e || !r) return { status: "not_found" };
	if (!actsFor(group.members, uid, targetUid) && !actsFor(group.members, uid, e.paidBy)) return { status: "not_found" };
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
const NO_PAYMENTS = { shares: { $not: { $elemMatch: { $or: [{ paidCents: { $gt: 0 } }, { status: "paid" }] } } } };

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
	const isAdmin = group.members.some((m) => m.uid === uid && m.role === "admin");
	const allowed = (x: { paidBy: string }) => actsFor(group.members, uid, x.paidBy) || isAdmin;
	if (!allowed(e)) return { status: "forbidden" };
	if (hasPayments(e)) return { status: "has_payment" };

	if (scope === "this" || !e.installment) {
		// Condicional: se um pagamento entrar no meio do caminho, não apaga.
		const res = await expensesCollection(db).deleteOne({ _id: e._id, groupId: e.groupId, ...NO_PAYMENTS });
		if (res.deletedCount === 0) {
			return (await findExpense(db, groupId, eid)) ? { status: "has_payment" } : { status: "no_expense" };
		}
		await releaseAttachments(db, store, e.attachments.map((a) => a.key));
		await deleteAttachments(store, receiptKeysOf(e));
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
	const withReceipts = targets.filter((t) => receiptKeysOf(t).length > 0);
	if (withReceipts.length > 0) {
		// Só as parcelas que de fato foram apagadas perdem os comprovantes.
		const left = await expensesCollection(db)
			.find({ _id: { $in: withReceipts.map((t) => t._id) } }, { projection: { _id: 1 } })
			.toArray();
		const stillThere = new Set(left.map((d) => d._id.toHexString()));
		await deleteAttachments(store, withReceipts.filter((t) => !stillThere.has(t._id.toHexString())).flatMap(receiptKeysOf));
	}
	return { status: "ok", deleted: res.deletedCount, kept: targets.length - res.deletedCount };
}

const receiptKeysOf = (e: { shares: ExpenseShare[] }): string[] => e.shares.flatMap((s) => (s.receipt ? [s.receipt.key] : []));

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

type Mutation = (e: ExpenseDoc) => { shares: ExpenseShare[]; changed: boolean } | { error: unknown };
type Mutated =
	| { kind: "ok"; doc: ExpenseDoc; before: ExpenseDoc; wrote: boolean }
	| { kind: "no_expense" }
	| { kind: "conflict" }
	| { kind: "rejected"; error: unknown };

/**
 * Lê a despesa, calcula as novas cotas e grava só se a `version` lida ainda for a atual.
 * Se perder a corrida, relê e tenta mais uma vez; depois disso, "conflict".
 */
async function mutateShares(db: Db, groupId: string, eid: string, mutate: Mutation): Promise<Mutated> {
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
			{ $set: { shares: m.shares, updatedAt: now }, $inc: { version: 1 } },
		);
		if (res.matchedCount > 0) {
			return { kind: "ok", doc: { ...e, shares: m.shares, version: (e.version ?? 0) + 1, updatedAt: now }, before: e, wrote: true };
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
 * Quem pagou a despesa quita (paid) ou desfaz (pending) a cota de outra pessoa. "Quitar" vale tanto para
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
		if (!actsFor(group.members, uid, e.paidBy)) return { error: "forbidden" };
		const change = status === "paid" ? settleShare(e.shares, e.paidBy, targetUid, new Date(), uid) : undoShare(e.shares, e.paidBy, targetUid);
		return change ?? { error: "no_share" };
	});
	if (r.kind === "no_expense") return { status: "no_expense" };
	if (r.kind === "conflict") return { status: "conflict" };
	if (r.kind === "rejected") return { status: r.error === "forbidden" ? "forbidden" : "no_share" };
	if (store && r.wrote) await deleteAttachments(store, droppedReceiptKeys(r.before.shares, r.doc.shares));
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
	if (r.wrote) await deleteAttachments(store, droppedReceiptKeys(r.before.shares, r.doc.shares));
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
		if (!actsFor(group.members, uid, e.paidBy)) return { error: { status: "forbidden" } };
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
		if (store && r.wrote) await deleteAttachments(store, droppedReceiptKeys(r.before.shares, r.doc.shares));
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
	if (store) await deleteAttachments(store, written.flatMap((w) => droppedReceiptKeys(w.before.shares, w.doc.shares)));
	const mine = written.find((w) => w.doc._id.equals(first._id))?.doc ?? first;
	return { status: "ok", expense: await toDetail(db, mine, group, uid, now) };
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
 * Só grupos em que `uid` é membro AGORA. Os totais são estritamente os de `uid` (a mesma conta de GET /api/groups);
 * `managed` traz o saldo de cada pessoa sem login pela qual `uid` é responsável AGORA. Uma única agregação.
 * Todo campo do topo é a soma dos campos dos grupos.
 */
export async function getSummary(db: Db, uid: string, now: Date = new Date()): Promise<Summary> {
	const groups = await groupsCollection(db)
		.find({ "members.uid": uid }, { projection: { _id: 1, name: 1, members: 1 } })
		.toArray();
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
