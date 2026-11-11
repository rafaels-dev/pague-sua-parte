export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";
export type PixKey = { type: PixKeyType; key: string };

export const PIX_KEY_LABELS: Record<PixKeyType, string> = {
	cpf: "CPF",
	cnpj: "CNPJ",
	email: "E-mail",
	phone: "Celular",
	random: "Chave aleatória",
};

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NUMERIC_FORMAT_RE = /^[\d\s.\-/()+]+$/;

function allSame(d: string): boolean {
	return /^(\d)\1+$/.test(d);
}

export function isValidCpf(d: string): boolean {
	if (!/^\d{11}$/.test(d) || allSame(d)) return false;
	for (const len of [9, 10]) {
		let sum = 0;
		for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
		const dv = ((sum * 10) % 11) % 10;
		if (dv !== Number(d[len])) return false;
	}
	return true;
}

export function isValidCnpj(d: string): boolean {
	if (!/^\d{14}$/.test(d) || allSame(d)) return false;
	for (const len of [12, 13]) {
		const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
		let sum = 0;
		for (let i = 0; i < len; i++) sum += Number(d[i]) * weights[i];
		const r = sum % 11;
		const dv = r < 2 ? 0 : 11 - r;
		if (dv !== Number(d[len])) return false;
	}
	return true;
}

/** Celular brasileiro: DDD (11-99) + 9 + 8 dígitos. */
function isMobileNational(d: string): boolean {
	return /^[1-9][1-9]9\d{8}$/.test(d);
}

export function normalizePixKey(input: string): PixKey | null {
	const raw = input.trim();
	if (!raw) return null;

	if (raw.includes("@")) {
		const email = raw.toLowerCase();
		if (email.length > 77 || !EMAIL_RE.test(email)) return null;
		return { type: "email", key: email };
	}

	const lower = raw.toLowerCase();
	if (UUID_V4_RE.test(lower)) return { type: "random", key: lower };

	if (!NUMERIC_FORMAT_RE.test(raw)) return null;
	const digits = raw.replace(/\D/g, "");
	const hasPlus = raw.startsWith("+");

	if (hasPlus) {
		if (digits.length === 13 && digits.startsWith("55") && isMobileNational(digits.slice(2))) {
			return { type: "phone", key: `+${digits}` };
		}
		return null;
	}
	if (digits.length === 14) return isValidCnpj(digits) ? { type: "cnpj", key: digits } : null;
	if (digits.length === 11) {
		if (isValidCpf(digits)) return { type: "cpf", key: digits };
		if (isMobileNational(digits)) return { type: "phone", key: `+55${digits}` };
		return null;
	}
	if (digits.length === 13 && digits.startsWith("55") && isMobileNational(digits.slice(2))) {
		return { type: "phone", key: `+${digits}` };
	}
	return null;
}

export function detectPixKeyType(input: string): PixKeyType | null {
	return normalizePixKey(input)?.type ?? null;
}
