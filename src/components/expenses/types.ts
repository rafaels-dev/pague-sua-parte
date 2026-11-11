import type { ShareStatus, YourStatus } from "@/lib/ui/expense-status";
import type { PixKeyType } from "@/lib/pix/key";

export type ExpenseSummary = {
	id: string;
	description: string;
	amountCents: number;
	date: string;
	paidBy: { uid: string; name: string; isYou: boolean };
	yourShareCents: number;
	yourStatus: YourStatus;
	pendingCount: number;
	attachmentCount: number;
};

export type ExpenseShare = {
	uid: string;
	name: string;
	picture: string | null;
	amountCents: number;
	status: ShareStatus;
	isYou: boolean;
	paidAt: string | null;
	method: "manual" | null;
};

export type ExpenseAttachment = { id: string; name: string; contentType: string; size: number };

export type ExpenseDetailData = {
	id: string;
	groupId: string;
	description: string;
	amountCents: number;
	date: string;
	createdAt: string;
	canDelete: boolean;
	canMarkPaid: boolean;
	paidBy: { uid: string; name: string; picture: string | null; isYou: boolean };
	pix: { type: PixKeyType; key: string; payeeName: string };
	shares: ExpenseShare[];
	attachments: ExpenseAttachment[];
};

/** Recado curto entre telas (ex.: "Despesa lançada!"), guardado só até a próxima tela mostrá-lo. */
const FLASH_KEY = "paguesuaparte:flash";

export function setFlash(message: string): void {
	try {
		sessionStorage.setItem(FLASH_KEY, message);
	} catch {
		// sem armazenamento: a tela seguinte simplesmente não mostra o recado
	}
}

/** Lê o recado sem apagá-lo (seguro de chamar na criação do estado). */
export function peekFlash(): string | null {
	try {
		return sessionStorage.getItem(FLASH_KEY);
	} catch {
		return null;
	}
}

export function clearFlash(): void {
	try {
		sessionStorage.removeItem(FLASH_KEY);
	} catch {
		// nada a limpar
	}
}
