/** Funções puras de texto/links usadas nas telas de grupos e convites. */

export function buildInviteLink(origin: string, token: string): string {
	return `${origin.replace(/\/+$/, "")}/convite/${encodeURIComponent(token)}`;
}

export function buildShareText(groupName: string, link: string): string {
	return `Entre no grupo "${groupName}" no Racha Pix para dividirmos as despesas: ${link}`;
}

export function buildWhatsAppUrl(text: string): string {
	return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function peopleLabel(count: number): string {
	return count === 1 ? "1 pessoa" : `${count} pessoas`;
}

/** Primeira letra (maiúscula) do nome, para o avatar sem foto. */
export function initialOf(name: string): string {
	const first = Array.from(name.trim())[0];
	return first ? first.toLocaleUpperCase("pt-BR") : "?";
}
