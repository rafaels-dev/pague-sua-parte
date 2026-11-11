import { z } from "zod";
import { normalizePixKey, type PixKey } from "@/lib/pix/key";
import { MAX_NAME_LENGTH } from "./helpers";

export const PIX_ERROR =
	"Chave Pix inválida. Confira se é um CPF, CNPJ, e-mail, celular com DDD ou chave aleatória válidos.";
const NAME_ERROR = "Informe o nome da pessoa.";

const name = z
	.string(NAME_ERROR)
	.trim()
	.min(1, NAME_ERROR)
	.max(MAX_NAME_LENGTH, `O nome pode ter no máximo ${MAX_NAME_LENGTH} letras.`);
const managedBy = z.string("Escolha quem vai cuidar dessa pessoa.").min(1, "Escolha quem vai cuidar dessa pessoa.").max(128);

const createSchema = z.object({ name, managedBy, pixKey: z.string().max(200, PIX_ERROR).nullish() });
const patchSchema = z.object({ name: name.optional(), managedBy: managedBy.optional(), pixKey: z.string().max(200, PIX_ERROR).nullable().optional() });

export type ManagedFail = { ok: false; error: string; field: string };

function fieldOf(issue: z.core.$ZodIssue | undefined): string {
	const f = String(issue?.path[0] ?? "name");
	return f === "managedBy" || f === "pixKey" ? f : "name";
}

function pix(raw: string | null | undefined): { ok: true; value: PixKey | null | undefined } | ManagedFail {
	if (raw === undefined) return { ok: true, value: undefined };
	if (raw === null || raw.trim() === "") return { ok: true, value: null };
	const key = normalizePixKey(raw);
	return key ? { ok: true, value: key } : { ok: false, error: PIX_ERROR, field: "pixKey" };
}

export function parseCreateManaged(
	raw: unknown,
): { ok: true; value: { name: string; managedBy: string; pixKey?: PixKey } } | ManagedFail {
	const parsed = createSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos.", field: fieldOf(parsed.error.issues[0]) };
	const k = pix(parsed.data.pixKey);
	if (!k.ok) return k;
	return { ok: true, value: { name: parsed.data.name, managedBy: parsed.data.managedBy, ...(k.value ? { pixKey: k.value } : {}) } };
}

export function parsePatchManaged(
	raw: unknown,
): { ok: true; value: { name?: string; managedBy?: string; pixKey?: PixKey | null } } | ManagedFail {
	const parsed = patchSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos.", field: fieldOf(parsed.error.issues[0]) };
	const k = pix(parsed.data.pixKey);
	if (!k.ok) return k;
	const { name: n, managedBy: m } = parsed.data;
	return { ok: true, value: { ...(n !== undefined ? { name: n } : {}), ...(m !== undefined ? { managedBy: m } : {}), ...(k.value !== undefined ? { pixKey: k.value } : {}) } };
}
