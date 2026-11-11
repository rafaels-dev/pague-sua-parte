export type Share = { uid: string; amountCents: number };

/**
 * Divide `amountCents` igualmente entre os participantes, em centavos inteiros.
 * A sobra vai para quem pagou (se participa); caso contrário, 1 centavo para
 * cada um dos primeiros participantes, na ordem dada.
 */
export function splitEqually(amountCents: number, participantUids: string[], payerUid: string): Share[] {
	if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Valor deve ser um inteiro positivo em centavos");
	const n = participantUids.length;
	if (n === 0) throw new Error("É preciso ao menos um participante");
	if (new Set(participantUids).size !== n) throw new Error("Participantes duplicados");
	if (amountCents < n) throw new Error("Valor menor que o número de participantes");

	const base = Math.floor(amountCents / n);
	const rest = amountCents - base * n;
	const payerIncluded = participantUids.includes(payerUid);

	return participantUids.map((uid, i) => ({
		uid,
		amountCents: base + (payerIncluded ? (uid === payerUid ? rest : 0) : i < rest ? 1 : 0),
	}));
}
