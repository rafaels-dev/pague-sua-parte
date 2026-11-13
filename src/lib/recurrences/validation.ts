import { z } from "zod";
import { MAX_AMOUNT_CENTS, MAX_DESCRIPTION, type Invalid } from "@/lib/expenses/validation";
import { addPeriods, currentPeriod, defaultStartPeriod, isPeriod, MAX_END_YEARS_AHEAD, MAX_START_MONTHS_AHEAD, type ParticipantMode } from "./period";

export type RecurrenceInput = {
	description: string;
	amountCents: number;
	dayOfMonth: number;
	participantMode: ParticipantMode;
	participantUids: string[];
	paidByUid?: string;
	startPeriod: string;
	endPeriod?: string;
};

export type RecurrencePatch = {
	description?: string;
	amountCents?: number;
	dayOfMonth?: number;
	participantMode?: ParticipantMode;
	participantUids?: string[];
	/** null = sem fim. */
	endPeriod?: string | null;
};

const FIELDS = ["description", "amountCents", "dayOfMonth", "participantMode", "participantUids", "paidByUid", "startPeriod", "endPeriod"];

const fields = {
	description: z
		.string({ message: "Descreva a despesa (até 80 letras)." })
		.trim()
		.min(1, "Descreva a despesa (até 80 letras).")
		.max(MAX_DESCRIPTION, "A descrição pode ter no máximo 80 letras."),
	amountCents: z
		.number({ message: "Informe um valor válido." })
		.int("Informe um valor válido.")
		.min(1, "O valor precisa ser maior que zero.")
		.max(MAX_AMOUNT_CENTS, "O valor máximo é R$ 1.000.000,00."),
	dayOfMonth: z
		.number({ message: "Escolha o dia do mês (de 1 a 31)." })
		.int("Escolha o dia do mês (de 1 a 31).")
		.min(1, "Escolha o dia do mês (de 1 a 31).")
		.max(31, "Escolha o dia do mês (de 1 a 31)."),
	participantMode: z.enum(["all", "selected", "alone"], { message: "Escolha quem divide a despesa." }),
	participantUids: z
		.array(z.string().min(1).max(128), { message: "Escolha quem divide a despesa." })
		.max(100, "Participantes demais."),
	paidByUid: z.string({ message: "Escolha quem pagou." }).min(1, "Escolha quem pagou.").max(128, "Escolha quem pagou."),
	startPeriod: z.string({ message: "Mês inicial inválido." }),
	endPeriod: z.string({ message: "Mês final inválido." }),
};

const createSchema = z.object({
	...fields,
	participantUids: fields.participantUids.optional(),
	paidByUid: fields.paidByUid.optional(),
	startPeriod: fields.startPeriod.nullish(),
	endPeriod: fields.endPeriod.nullish(),
});
const patchSchema = z.object({
	description: fields.description.optional(),
	amountCents: fields.amountCents.optional(),
	dayOfMonth: fields.dayOfMonth.optional(),
	participantMode: fields.participantMode.optional(),
	participantUids: fields.participantUids.optional(),
	endPeriod: fields.endPeriod.nullable().optional(),
});

const fail = (field: string, error: string): Invalid => ({ ok: false, status: 422, error, field });
const BAD_END = "Mês final inválido.";

function zodFail(error: z.ZodError): Invalid {
	const issue = error.issues[0];
	const field = String(issue.path[0] ?? "description");
	return fail(FIELDS.includes(field) ? field : "description", issue.message);
}

function checkUids(mode: ParticipantMode, uids: string[]): Invalid | null {
	if (new Set(uids).size !== uids.length) return fail("participantUids", "Há participantes repetidos.");
	if (mode === "selected" && uids.length === 0) return fail("participantUids", "Escolha quem divide a despesa.");
	return null;
}

function checkEnd(end: string, now: Date): Invalid | null {
	if (!isPeriod(end)) return fail("endPeriod", BAD_END);
	if (end > addPeriods(currentPeriod(now), MAX_END_YEARS_AHEAD * 12)) return fail("endPeriod", "O mês final pode ser no máximo daqui a 5 anos.");
	return null;
}

export function parseRecurrenceInput(raw: unknown, now: Date = new Date()): { ok: true; value: RecurrenceInput } | Invalid {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("description", "Dados inválidos.");
	if ((raw as Record<string, unknown>).cashback != null) return fail("cashback", "Despesa fixa não aceita cashback.");
	const parsed = createSchema.safeParse(raw);
	if (!parsed.success) return zodFail(parsed.error);
	const d = parsed.data;
	const uids = d.participantMode === "selected" ? (d.participantUids ?? []) : [];
	const bad = checkUids(d.participantMode, uids);
	if (bad) return bad;

	const current = currentPeriod(now);
	let startPeriod = defaultStartPeriod(d.dayOfMonth, now);
	if (d.startPeriod != null) {
		if (!isPeriod(d.startPeriod)) return fail("startPeriod", "Mês inicial inválido.");
		if (d.startPeriod < current) return fail("startPeriod", "O mês inicial não pode ser anterior ao mês atual.");
		if (d.startPeriod > addPeriods(current, MAX_START_MONTHS_AHEAD)) return fail("startPeriod", "O mês inicial pode ser no máximo daqui a 12 meses.");
		startPeriod = d.startPeriod;
	}
	let endPeriod: string | undefined;
	if (d.endPeriod != null) {
		const badEnd = checkEnd(d.endPeriod, now);
		if (badEnd) return badEnd;
		if (d.endPeriod < startPeriod) return fail("endPeriod", "O mês final não pode ser anterior ao inicial.");
		endPeriod = d.endPeriod;
	}
	return {
		ok: true,
		value: {
			description: d.description,
			amountCents: d.amountCents,
			dayOfMonth: d.dayOfMonth,
			participantMode: d.participantMode,
			participantUids: uids,
			...(d.paidByUid ? { paidByUid: d.paidByUid } : {}),
			startPeriod,
			...(endPeriod ? { endPeriod } : {}),
		},
	};
}

export function parseRecurrencePatch(raw: unknown, now: Date = new Date()): { ok: true; value: RecurrencePatch } | Invalid {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("description", "Dados inválidos.");
	const parsed = patchSchema.safeParse(raw);
	if (!parsed.success) return zodFail(parsed.error);
	const d = parsed.data;
	const value: RecurrencePatch = {};
	if (d.description !== undefined) value.description = d.description;
	if (d.amountCents !== undefined) value.amountCents = d.amountCents;
	if (d.dayOfMonth !== undefined) value.dayOfMonth = d.dayOfMonth;
	if (d.participantMode !== undefined) value.participantMode = d.participantMode;
	if (d.participantUids !== undefined) {
		if (new Set(d.participantUids).size !== d.participantUids.length) return fail("participantUids", "Há participantes repetidos.");
		value.participantUids = d.participantUids;
	}
	if (d.endPeriod !== undefined) {
		if (d.endPeriod !== null) {
			const badEnd = checkEnd(d.endPeriod, now);
			if (badEnd) return badEnd;
		}
		value.endPeriod = d.endPeriod;
	}
	if (Object.keys(value).length === 0) return fail("description", "Nada para alterar.");
	return { ok: true, value };
}
