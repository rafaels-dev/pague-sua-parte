import { z } from "zod";
import { addMonthsClamped, isRealDate, todayInSaoPaulo } from "@/lib/expenses/dates";
import { MAX_AMOUNT_CENTS, MAX_DESCRIPTION, MIN_DATE, parseExpenseInput, type Invalid } from "@/lib/expenses/validation";
import { MAX_NAME_LENGTH } from "@/lib/groups/helpers";

export const MAX_DETAILS = 1000;
export const MAX_GUEST_NAME = 40;
export const MAX_DATE_YEARS_AHEAD = 5;

export const MIN_EXPECTED_PEOPLE = 2;
export const MAX_EXPECTED_PEOPLE = 200;

export type PlanInput = { name: string; totalCents: number; deadline?: string; eventDate?: string; details?: string; expectedPeople?: number };

const fail = (field: string, error: string, status = 422): Invalid => ({ ok: false, status, error, field });

/** Texto livre: quebras de linha viram "\n", sem caracteres de controle, sem espaços nas pontas. */
export function cleanDetails(raw: string): string {
	return raw
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, "")
		.replace(/\n{4,}/g, "\n\n\n")
		.trim();
}

const schema = z.object({
	name: z
		.string({ message: "Dê um nome ao plano (até 80 letras)." })
		.trim()
		.min(1, "Dê um nome ao plano (até 80 letras).")
		.max(MAX_DESCRIPTION, "O nome pode ter no máximo 80 letras."),
	totalCents: z
		.number({ message: "Informe um valor válido." })
		.int("Informe um valor válido.")
		.min(1, "O valor precisa ser maior que zero.")
		.max(MAX_AMOUNT_CENTS, "O valor máximo é R$ 1.000.000,00."),
	deadline: z.string({ message: "Data inválida." }).nullish(),
	eventDate: z.string({ message: "Data inválida." }).nullish(),
	details: z.string({ message: "Texto inválido." }).nullish(),
	expectedPeople: z
		.number({ message: "Informe quantas pessoas (um número)." })
		.int("Informe quantas pessoas (um número inteiro).")
		.min(MIN_EXPECTED_PEOPLE, `Informe de ${MIN_EXPECTED_PEOPLE} a ${MAX_EXPECTED_PEOPLE} pessoas.`)
		.max(MAX_EXPECTED_PEOPLE, `Informe de ${MIN_EXPECTED_PEOPLE} a ${MAX_EXPECTED_PEOPLE} pessoas.`)
		.nullish(),
});

function checkDate(value: string | null | undefined, field: string, now: Date): { value?: string } | Invalid {
	if (value === undefined || value === null || value === "") return {};
	if (!isRealDate(value)) return fail(field, "Data inválida.");
	if (value < MIN_DATE) return fail(field, "A data não pode ser anterior a 2000.");
	if (value > addMonthsClamped(todayInSaoPaulo(now), MAX_DATE_YEARS_AHEAD * 12)) return fail(field, "A data pode ser no máximo daqui a 5 anos.");
	return { value };
}

/** Corpo de criar/editar um plano (sempre o estado completo dos campos editáveis). */
export function parsePlanInput(raw: unknown, now: Date = new Date()): { ok: true; value: PlanInput } | Invalid {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("name", "Dados inválidos.");
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const field = String(issue.path[0] ?? "name");
		return fail(["name", "totalCents", "deadline", "eventDate", "details", "expectedPeople"].includes(field) ? field : "name", issue.message);
	}
	const deadline = checkDate(parsed.data.deadline, "deadline", now);
	if ("ok" in deadline) return deadline;
	const eventDate = checkDate(parsed.data.eventDate, "eventDate", now);
	if ("ok" in eventDate) return eventDate;
	const details = cleanDetails(parsed.data.details ?? "");
	if (Array.from(details).length > MAX_DETAILS) return fail("details", `Os detalhes podem ter no máximo ${MAX_DETAILS} letras.`);
	return {
		ok: true,
		value: {
			name: parsed.data.name,
			totalCents: parsed.data.totalCents,
			...(deadline.value ? { deadline: deadline.value } : {}),
			...(eventDate.value ? { eventDate: eventDate.value } : {}),
			...(details ? { details } : {}),
			...(parsed.data.expectedPeople ? { expectedPeople: parsed.data.expectedPeople } : {}),
		},
	};
}

export type ResponseInput = { going: boolean; limitCents?: number };

/** Corpo de `PUT .../responses/:who`: `{ going, limitCents? }`. `limitCents` vazio/ausente = sem limite. */
export function parseResponseInput(raw: unknown): { ok: true; value: ResponseInput } | Invalid {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("going", "Dados inválidos.");
	const b = raw as Record<string, unknown>;
	// Versão antiga da tela mandava "sameAsShare": ignorar apagaria o limite gravado, então recusa.
	if ("sameAsShare" in b) return fail("sameAsShare", "Atualize a página e responda de novo.");
	if (typeof b.going !== "boolean") return fail("going", "Diga se você vai ou não.");
	if (!b.going) return { ok: true, value: { going: false } };
	if (b.limitCents === undefined || b.limitCents === null) return { ok: true, value: { going: true } };
	if (typeof b.limitCents !== "number" || !Number.isInteger(b.limitCents) || b.limitCents < 1 || b.limitCents > MAX_AMOUNT_CENTS) {
		return fail("limitCents", "Informe um limite válido, maior que zero.");
	}
	return { ok: true, value: { going: true, limitCents: b.limitCents } };
}

/** Nome da pessoa sem celular. */
export function parseGuestName(raw: unknown): { ok: true; value: string } | Invalid {
	const name = typeof (raw as { name?: unknown } | null)?.name === "string" ? (raw as { name: string }).name.replace(/\s+/g, " ").trim() : "";
	if (!name) return fail("name", "Escreva o nome da pessoa.");
	if (Array.from(name).length > MAX_GUEST_NAME) return fail("name", `O nome pode ter no máximo ${MAX_GUEST_NAME} letras.`);
	return { ok: true, value: name };
}

export type CloseInput = {
	groupName: string;
	/** Quem divide (ids de pessoas do plano); no modo só-grupo, quem entra no grupo. */
	participantIds: string[];
	/** Lançar a despesa inicial com o valor do plano? `false`: só o grupo. */
	createExpense: boolean;
	/** Quem pagou (id de uma das pessoas escolhidas). Só com `createExpense`. */
	paidBy?: string;
	date?: string;
	dueDate?: string;
};

/**
 * Corpo de "Criar grupo e despesa" (ou só o grupo). `createExpense` ausente = `true` (cliente antigo); outro valor que não seja
 * booleano = 422. O que é da despesa (data, vencimento, divisão) passa pela mesma validação do lançamento; o valor e a descrição vêm
 * do plano (`totalCents`, `name`), nunca do cliente. Só-grupo: `paidBy`, `date` e `dueDate` são ignorados (não há despesa).
 */
export function parseCloseInput(raw: unknown, plan: { name: string; totalCents: number }, now: Date = new Date()): { ok: true; value: CloseInput } | Invalid {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("groupName", "Dados inválidos.");
	const b = raw as Record<string, unknown>;
	const groupName = typeof b.groupName === "string" ? b.groupName.replace(/\s+/g, " ").trim() : "";
	if (!groupName) return fail("groupName", "Dê um nome ao grupo.");
	if (Array.from(groupName).length > MAX_NAME_LENGTH) return fail("groupName", `O nome do grupo pode ter no máximo ${MAX_NAME_LENGTH} letras.`);
	if (b.createExpense !== undefined && typeof b.createExpense !== "boolean") return fail("createExpense", "Escolha se a despesa será lançada.");
	const createExpense = b.createExpense !== false;
	if (!createExpense) {
		const only = parseExpenseInput({ description: plan.name, amountCents: plan.totalCents, participantUids: b.participantIds }, now);
		if (!only.ok) return only.field === "participantUids" ? { ...only, field: "participantIds" } : only;
		return { ok: true, value: { groupName, participantIds: only.value.participantUids, createExpense: false } };
	}
	if (typeof b.paidBy !== "string" || !b.paidBy || b.paidBy.length > 128) return fail("paidBy", "Escolha quem pagou.");
	const expense = parseExpenseInput(
		{ description: plan.name, amountCents: plan.totalCents, date: b.date, participantUids: b.participantIds, dueDate: b.dueDate },
		now,
	);
	if (!expense.ok) return expense.field === "participantUids" ? { ...expense, field: "participantIds" } : expense;
	if (!expense.value.participantUids.includes(b.paidBy)) return fail("paidBy", "Quem pagou precisa estar entre quem divide.");
	return {
		ok: true,
		value: {
			groupName,
			participantIds: expense.value.participantUids,
			createExpense: true,
			paidBy: b.paidBy,
			date: expense.value.date,
			...(expense.value.dueDate ? { dueDate: expense.value.dueDate } : {}),
		},
	};
}
