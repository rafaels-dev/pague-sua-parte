import type { MemberLike } from "@/lib/groups/helpers";

/** Uma mensagem para uma pessoa com login. Nunca leva chave Pix. `url` é relativo ao app. */
export type Notice = { uid: string; title: string; body: string; url: string };

export type GroupInfo = { name: string; members: (MemberLike & { name?: string })[] };

/** O que as funções de mensagem precisam saber do grupo e dos nomes (carregado do banco por `events.ts`). */
export type NoticeContext = {
	group: (groupId: string) => GroupInfo | undefined;
	name: (groupId: string, uid: string) => string;
};

/** Uma cota que passou a paga (ou uma devolução feita) numa gravação bem-sucedida. */
export type PaymentFact = {
	groupId: string;
	expenseId: string;
	description: string;
	/** Quem pagou a despesa (quem recebe). */
	paidBy: string;
	/** A pessoa da cota (quem pagou a sua parte, ou quem recebe a devolução). */
	debtorUid: string;
	amountCents: number;
	kind: "payment" | "refund";
	actorUid: string;
	/** Marcada por outra pessoa (dono ou administrador), e não pela própria pessoa. */
	manual: boolean;
};

/** Uma despesa nova (ou pessoas que entraram numa despesa existente). */
export type NewExpenseFact = {
	groupId: string;
	expenseId: string;
	description: string;
	amountCents: number;
	paidBy: string;
	/** Quem lançou/editou; null nas despesas fixas geradas sozinhas. */
	actorUid: string | null;
	shares: { uid: string; amountCents: number }[];
	/** Número de parcelas, quando a despesa foi lançada parcelada. */
	installments?: number;
};
export type NewExpenseMode = "created" | "recurring" | "added";

/** O que os avisos de um plano precisam saber, num instante. Fica só na memória do servidor: os limites nunca vão a ninguém além do dono do limite. */
export type PlanNoticeBase = {
	planId: string;
	name: string;
	/** Total do plano (centavos), para dizer a partir de quantas pessoas o limite de alguém cabe. */
	totalCents: number;
	actorUid: string;
	creatorUid: string;
	/** Participantes atuais (uids) e pessoas sem celular com quem as acrescentou. */
	participants: string[];
	guests: { id: string; name: string; addedBy: string }[];
};
export type PlanSnapshot = {
	fits: boolean;
	shareCents: number | null;
	includedUids: string[];
	aboveLimitUids: string[];
	shareIfIncluded: Record<string, number>;
};
export type PlanChangeFact = PlanNoticeBase & { before: PlanSnapshot; after: PlanSnapshot; limits: Record<string, number> };
export type PlanCancelFact = PlanNoticeBase & { goingIds: string[] };
export type PlanClosedFact = PlanNoticeBase & { leftOutIds: string[] };
