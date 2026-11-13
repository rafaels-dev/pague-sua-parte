import { computePlan, maxShare, type PlanComputation, type PlanHint } from "./compute";
import { sharePreview, type SharePreview } from "./preview";
import { MAX_GUESTS_PER_PERSON, MAX_PLAN_PEOPLE, peopleOf, type PlanDoc, type PlanStatus } from "./collection";

export type PlanAnswerState = "going" | "not_going" | "pending";

export type PlanPersonView = {
	/** uid do participante ou id da pessoa sem celular. */
	id: string;
	name: string;
	picture: string | null;
	kind: "participant" | "guest";
	isYou: boolean;
	isCreator: boolean;
	/** Você responde por esta pessoa (é você, ou ela foi acrescentada por você). */
	youAnswer: boolean;
	/** Você pode tirar esta pessoa do plano. */
	canRemove: boolean;
	addedByName: string | null;
	answer: PlanAnswerState;
	/** SÓ para a própria pessoa, para quem a acrescentou e para quem criou o plano; null para os demais. */
	limitCents: number | null;
	/** Mesmas regras de `limitCents`: ficou fora da conta por causa do limite? null = você não pode saber. */
	aboveLimit: boolean | null;
	/** Mesmas regras: quanto seria a parte se entrasse na conta agora. */
	shareIfIncludedCents: number | null;
	/** Só para quem responde por esta pessoa: o valor previsto da parte dela (indicativo para o campo de limite). */
	preview: SharePreview | null;
};

export type PlanResultView = {
	fits: boolean;
	shareCents: number | null;
	includedCount: number;
	goingCount: number;
	pendingCount: number;
	notGoingCount: number;
	peopleCount: number;
	/** Quantas pessoas o criador pensa em chamar; null = não informou. */
	expectedPeople: number | null;
	/** Quantas pessoas contam em "se forem todas": o previsto, ou as que já estão no plano se forem mais (nunca menos). */
	allCount: number;
	/** A parte se forem `allCount` pessoas. */
	shareIfAllCents: number | null;
	/** Quantas já responderam e quantas faltam (nunca negativo). */
	answeredCount: number;
	missingCount: number;
	hint: PlanHint | null;
};

export type PlanAttachmentView = { id: string; name: string; contentType: string; size: number };

export type PlanView = {
	id: string;
	name: string;
	totalCents: number;
	deadline: string | null;
	eventDate: string | null;
	details: string | null;
	status: PlanStatus;
	expectedPeople: number | null;
	createdAt: string;
	creator: { uid: string; name: string; isYou: boolean };
	isCreator: boolean;
	/** O plano ainda recebe respostas. */
	open: boolean;
	canClose: boolean;
	canEdit: boolean;
	canAddGuest: boolean;
	result: PlanResultView;
	/** SÓ para quem criou o plano: quem entra na divisão e quem disse "Vou" (sugestão do botão "Criar o grupo"). */
	includedIds: string[] | null;
	goingIds: string[] | null;
	people: PlanPersonView[];
	attachments: PlanAttachmentView[];
	/** SÓ para quem criou o plano, com o plano aberto: quem ele tirou (pode permitir que volte pelo link). */
	removed: { uid: string; name: string }[];
	/** Preenchido quando o plano virou grupo. `groupId` só vai para quem entrou no grupo. */
	closed: { groupName: string; groupId: string | null; expenseId: string | null; hasExpense: boolean } | null;
};

export type PlanSummary = {
	id: string;
	name: string;
	totalCents: number;
	status: PlanStatus;
	eventDate: string | null;
	goingCount: number;
	peopleCount: number;
	fits: boolean;
	shareCents: number | null;
	includedCount: number;
	/** A meta: pessoas previstas pelo criador (nulo sem previsão), quantas contam em "se forem todas" e a parte nesse caso. */
	expectedPeople: number | null;
	allCount: number;
	shareIfAllCents: number | null;
	/** Você (ou alguém por quem você responde) ainda não respondeu. */
	needsMyAnswer: boolean;
	isCreator: boolean;
	/** Plano fechado que lançou a despesa inicial; falso quando virou só o grupo (ou não foi fechado). */
	hasExpense: boolean;
};

/** Quantas pessoas contam em "se forem todas": o previsto pelo criador (sem ficar abaixo de quem já está no plano). */
export function allCountOf(expectedPeople: number | undefined | null, peopleCount: number): number {
	return Math.max(expectedPeople ?? 0, peopleCount);
}

/** O que o plano guarda de cada pessoa que vai para a tela. */
export type PersonInfo = { name: string; picture: string | null };

export function computeFor(plan: Pick<PlanDoc, "totalCents" | "participants" | "guests" | "responses"> & { expectedPeople?: number }): PlanComputation {
	return computePlan(
		plan.totalCents,
		peopleOf(plan),
		plan.responses.map((r) => ({ who: r.who, going: r.going, limitCents: r.limitCents })),
		{ expectedPeople: plan.expectedPeople },
	);
}

const answerOf = (plan: PlanDoc, who: string): PlanAnswerState => {
	const r = plan.responses.find((x) => x.who === who);
	return r ? (r.going ? "going" : "not_going") : "pending";
};

/** Quem pode ver o limite de `who`: a própria pessoa, quem a acrescentou e quem criou o plano. Única fonte desta regra. */
export function canSeeLimit(plan: Pick<PlanDoc, "createdBy" | "guests">, caller: string, who: string): boolean {
	if (caller === plan.createdBy || caller === who) return true;
	return plan.guests.some((g) => g.id === who && g.addedBy === caller);
}

/** Você responde por `who`? (você mesmo, ou uma pessoa sem celular que você acrescentou) */
export function canAnswerFor(plan: Pick<PlanDoc, "guests">, caller: string, who: string): boolean {
	return caller === who || plan.guests.some((g) => g.id === who && g.addedBy === caller);
}

export function buildPlanView(
	plan: PlanDoc,
	caller: string,
	info: (uid: string) => PersonInfo,
	closed?: { groupId: string | null } | null,
): PlanView {
	const c = computeFor(plan);
	const isCreator = caller === plan.createdBy;
	const open = plan.status === "open";
	const people: PlanPersonView[] = [
		...plan.participants.map((p): PlanPersonView => ({ ...base(p.uid, "participant", null), kind: "participant" })),
		...plan.guests.map((g): PlanPersonView => ({ ...base(g.id, "guest", g.addedBy), kind: "guest" })),
	];

	function base(id: string, kind: "participant" | "guest", addedBy: string | null): PlanPersonView {
		const guest = plan.guests.find((g) => g.id === id);
		const i = kind === "guest" ? { name: guest?.name ?? "Convidado", picture: null } : info(id);
		const reveal = canSeeLimit(plan, caller, id);
		const above = c.aboveLimitUids.includes(id);
		const resp = plan.responses.find((r) => r.who === id);
		return {
			id,
			name: i.name,
			picture: i.picture,
			kind,
			isYou: id === caller,
			isCreator: id === plan.createdBy,
			youAnswer: canAnswerFor(plan, caller, id),
			// O criador tira qualquer um (menos ele mesmo); cada participante pode sair; quem acrescentou tira a sua pessoa.
			canRemove: open && id !== plan.createdBy && (isCreator || id === caller || (kind === "guest" && addedBy === caller)),
			addedByName: addedBy ? info(addedBy).name : null,
			answer: answerOf(plan, id),
			limitCents: reveal && resp?.going && typeof resp.limitCents === "number" ? resp.limitCents : null,
			aboveLimit: reveal ? above : null,
			shareIfIncludedCents: reveal && above ? (c.shareIfIncluded[id] ?? null) : null,
			preview: open && canAnswerFor(plan, caller, id) ? sharePreview(plan, id) : null,
		};
	}

	const allCount = allCountOf(plan.expectedPeople, c.peopleCount);
	const answeredCount = people.filter((p) => p.answer !== "pending").length;
	const closing = plan.status === "done" || plan.status === "closing";
	return {
		id: plan._id.toHexString(),
		name: plan.name,
		totalCents: plan.totalCents,
		deadline: plan.deadline ?? null,
		eventDate: plan.eventDate ?? null,
		details: plan.details ?? null,
		status: plan.status,
		expectedPeople: plan.expectedPeople ?? null,
		createdAt: plan.createdAt.toISOString(),
		creator: { uid: plan.createdBy, name: info(plan.createdBy).name, isYou: isCreator },
		isCreator,
		open,
		canClose: open && isCreator,
		canEdit: open && isCreator,
		canAddGuest:
			open && plan.guests.filter((g) => g.addedBy === caller).length < MAX_GUESTS_PER_PERSON && plan.participants.length + plan.guests.length < MAX_PLAN_PEOPLE,
		result: {
			fits: c.fits,
			shareCents: c.shareCents,
			includedCount: c.includedUids.length,
			goingCount: c.goingUids.length,
			pendingCount: people.filter((p) => p.answer === "pending").length,
			notGoingCount: people.filter((p) => p.answer === "not_going").length,
			peopleCount: c.peopleCount,
			expectedPeople: plan.expectedPeople ?? null,
			allCount,
			shareIfAllCents: maxShare(plan.totalCents, allCount),
			answeredCount,
			missingCount: Math.max(0, allCount - answeredCount),
			hint: c.hint,
		},
		includedIds: isCreator ? c.includedUids : null,
		goingIds: isCreator ? c.goingUids : null,
		people,
		attachments: plan.attachments.map((a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size })),
		removed: isCreator && open ? (plan.removed ?? []).map((uid) => ({ uid, name: info(uid).name })) : [],
		closed: closing && plan.groupName ? { groupName: plan.groupName, groupId: closed?.groupId ?? null, expenseId: closed?.groupId ? (plan.expenseId ?? null) : null, hasExpense: !!plan.expenseId } : null,
	};
}

export function buildPlanSummary(plan: PlanDoc, caller: string): PlanSummary {
	const c = computeFor(plan);
	const mine = peopleOf(plan).filter((id) => canAnswerFor(plan, caller, id));
	const allCount = allCountOf(plan.expectedPeople, c.peopleCount);
	return {
		id: plan._id.toHexString(),
		name: plan.name,
		totalCents: plan.totalCents,
		status: plan.status,
		eventDate: plan.eventDate ?? null,
		goingCount: c.goingUids.length,
		peopleCount: c.peopleCount,
		fits: c.fits,
		shareCents: c.shareCents,
		includedCount: c.includedUids.length,
		expectedPeople: plan.expectedPeople ?? null,
		allCount,
		shareIfAllCents: maxShare(plan.totalCents, allCount),
		needsMyAnswer: mine.some((id) => answerOf(plan, id) === "pending"),
		isCreator: caller === plan.createdBy,
		hasExpense: plan.status === "done" && !!plan.expenseId,
	};
}
