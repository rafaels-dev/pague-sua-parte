/** 128 bits aleatórios (Web Crypto) em hexadecimal. */
export function randomId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
