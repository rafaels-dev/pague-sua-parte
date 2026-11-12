/**
 * Payload estático do Pix ("Copia e Cola" / BR Code, EMV QRCPS-MPM), conforme o
 * Manual de Padrões para Iniciação do Pix do Banco Central.
 */

export type PixPayloadInput = {
	/** Chave já normalizada, como armazenada. */
	key: string;
	/** Nome de quem recebe, em qualquer caixa/acentuação. */
	payeeName: string;
	/** Valor em centavos (inteiro > 0). */
	amountCents: number;
	/** Referência opcional (somente [A-Za-z0-9], até 25). */
	txid?: string;
	/** Mensagem opcional que o app do banco mostra no pagamento (subcampo 26/02); cortada para caber. */
	description?: string;
	/** Cidade opcional (padrão "BRASIL"). */
	city?: string;
};

/** O campo 54 comporta no máximo 13 caracteres: "9999999999.99". */
const MAX_AMOUNT_CENTS = 999_999_999_999;
/** Campo 26 tem no máximo 99 caracteres: 18 (GUI) + 4 (cabeçalho da chave) + chave. */
const MAX_KEY_LENGTH = 77;

function tlv(id: string, value: string): string {
	if (value.length > 99) throw new Error(`Campo ${id} excede 99 caracteres`);
	return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF), 4 hexadecimais maiúsculos. */
export function crc16ccitt(payload: string): string {
	let crc = 0xffff;
	for (const byte of new TextEncoder().encode(payload)) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit++) {
			crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
		}
	}
	return crc.toString(16).toUpperCase().padStart(4, "0");
}

function sanitizeText(input: string, max: number, fallback: string): string {
	const cleaned = input
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^A-Za-z0-9 ]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase()
		.slice(0, max)
		.trim();
	return cleaned || fallback;
}

/** Espaço que sobra para a mensagem no campo 26 (máx. 99): 18 (GUI) + 4 + chave + 4 (cabeçalho do subcampo 02). */
export function descriptionBudget(key: string): number {
	return 99 - 18 - 4 - key.length - 4;
}

/** Menor mensagem que vale a pena enviar; abaixo disso, o subcampo 02 é omitido. */
const MIN_DESCRIPTION = 8;

/** Só letras, números e espaços; corta no limite, de preferência numa palavra inteira. Vazio = sem mensagem. */
export function sanitizeDescription(input: string | undefined, budget: number): string {
	if (!input || budget < MIN_DESCRIPTION) return "";
	const cleaned = input
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^A-Za-z0-9 ]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (cleaned.length <= budget) return cleaned;
	const cut = cleaned.slice(0, budget);
	const space = cut.lastIndexOf(" ");
	const atWord = cleaned[budget] === " " ? cut : space > 0 ? cut.slice(0, space) : "";
	// Se a primeira palavra sozinha já estoura, corta no meio dela em vez de perder a mensagem.
	return (atWord.trim() || cut).trim();
}

function sanitizeTxid(txid: string | undefined): string {
	const cleaned = (txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
	return cleaned || "***";
}

export function buildPixPayload(input: PixPayloadInput): string {
	const { key, payeeName, amountCents } = input;
	if (typeof key !== "string" || key.trim() === "") throw new Error("Chave Pix vazia");
	if (key.length > MAX_KEY_LENGTH) throw new Error("Chave Pix longa demais");
	if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Valor deve ser um inteiro positivo em centavos");
	if (amountCents > MAX_AMOUNT_CENTS) throw new Error("Valor acima do permitido pelo Pix");

	const amount = `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;
	const description = sanitizeDescription(input.description, descriptionBudget(key));
	const merchantAccount = tlv("00", "br.gov.bcb.pix") + tlv("01", key) + (description ? tlv("02", description) : "");

	const body =
		tlv("00", "01") +
		tlv("26", merchantAccount) +
		tlv("52", "0000") +
		tlv("53", "986") +
		tlv("54", amount) +
		tlv("58", "BR") +
		tlv("59", sanitizeText(payeeName ?? "", 25, "RECEBEDOR")) +
		tlv("60", sanitizeText(input.city ?? "", 15, "BRASIL")) +
		tlv("62", tlv("05", sanitizeTxid(input.txid))) +
		"6304";
	return body + crc16ccitt(body);
}
