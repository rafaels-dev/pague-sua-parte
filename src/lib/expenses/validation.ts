import { z } from "zod";

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_AMOUNT_CENTS = 100_000_000;
export const MAX_DESCRIPTION = 80;
export const MIN_DATE = "2000-01-01";

export type AllowedContentType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
const EXTENSION: Record<AllowedContentType, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"application/pdf": "pdf",
};

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/** Decide o tipo pelos primeiros bytes (magic bytes); o tipo/extensão declarados pelo cliente são ignorados. */
export function sniffContentType(b: Uint8Array): AllowedContentType | null {
	if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
	if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
	if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
	return null;
}

/** Nome para exibição: sem separadores de caminho, aspas nem caracteres de controle; até 80 caracteres. */
export function sanitizeFileName(raw: string, contentType: AllowedContentType): string {
	const cleaned = raw
		.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "")
		.replace(/[\\/"]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.trim();
	const name = Array.from(cleaned).slice(0, 80).join("").trim();
	return name || `anexo.${EXTENSION[contentType]}`;
}

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function todayInSaoPaulo(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Sao_Paulo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

function isRealDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(s: string, days: number): string {
	const d = new Date(`${s}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export type ExpenseInput = {
	description: string;
	amountCents: number;
	date: string;
	participantUids: string[];
};

export type Invalid = { ok: false; status: number; error: string; field: string };

const schema = z.object({
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
	date: z.string({ message: "Data inválida." }).optional(),
	participantUids: z
		.array(z.string().min(1).max(128), { message: "Escolha quem divide a despesa." })
		.min(1, "Escolha quem divide a despesa.")
		.max(100, "Participantes demais."),
});

export function parseExpenseInput(raw: unknown, now: Date = new Date()): { ok: true; value: ExpenseInput } | Invalid {
	const fail = (field: string, error: string): Invalid => ({ ok: false, status: 422, error, field });
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("description", "Dados inválidos.");
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const field = String(issue.path[0] ?? "description");
		return fail(["description", "amountCents", "date", "participantUids"].includes(field) ? field : "description", issue.message);
	}
	const today = todayInSaoPaulo(now);
	const date = parsed.data.date ?? today;
	if (!isRealDate(date)) return fail("date", "Data inválida.");
	if (date < MIN_DATE) return fail("date", "A data não pode ser anterior a 2000.");
	if (date > addDays(today, 1)) return fail("date", "A data não pode estar no futuro.");
	const uids = parsed.data.participantUids;
	if (new Set(uids).size !== uids.length) return fail("participantUids", "Há participantes repetidos.");
	return {
		ok: true,
		value: { description: parsed.data.description, amountCents: parsed.data.amountCents, date, participantUids: uids },
	};
}

const participantsSchema = z.object({ participantUids: schema.shape.participantUids });

/** Corpo de `PUT .../participants`: `{ participantUids }` com as mesmas regras do lançamento. */
export function parseParticipantsInput(raw: unknown): { ok: true; value: string[] } | Invalid {
	const fail = (error: string): Invalid => ({ ok: false, status: 422, error, field: "participantUids" });
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("Escolha quem divide a despesa.");
	const parsed = participantsSchema.safeParse(raw);
	if (!parsed.success) return fail(parsed.error.issues[0].message);
	const uids = parsed.data.participantUids;
	if (new Set(uids).size !== uids.length) return fail("Há participantes repetidos.");
	return { ok: true, value: uids };
}

/** Confere quantidade e tamanho ANTES de ler os bytes. */
export function checkFileLimits(files: { size: number }[]): Invalid | null {
	if (files.length > MAX_FILES) {
		return { ok: false, status: 422, error: "Você pode anexar até 3 arquivos.", field: "files" };
	}
	if (files.some((f) => f.size > MAX_FILE_BYTES)) {
		return { ok: false, status: 413, error: "Cada anexo pode ter no máximo 5 MB.", field: "files" };
	}
	return null;
}

export type SniffedFile = { name: string; contentType: AllowedContentType; bytes: Uint8Array };

export function sniffFiles(files: { name: string; bytes: Uint8Array }[]): { ok: true; files: SniffedFile[] } | Invalid {
	const limits = checkFileLimits(files.map((f) => ({ size: f.bytes.byteLength })));
	if (limits) return limits;
	const out: SniffedFile[] = [];
	for (const f of files) {
		const contentType = sniffContentType(f.bytes);
		if (!contentType) {
			return { ok: false, status: 415, error: "Só aceitamos foto (JPG, PNG, WebP) ou PDF.", field: "files" };
		}
		out.push({ name: sanitizeFileName(f.name, contentType), contentType, bytes: f.bytes });
	}
	return { ok: true, files: out };
}
