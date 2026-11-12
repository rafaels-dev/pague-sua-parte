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
