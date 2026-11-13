import { formatBRL } from "@/lib/money";
import type { ReminderItem } from "@/lib/reminders/plan";
import { clipText as clip, fitSubject } from "./subjects";
import type { Notice } from "./types";


/** "20/11" a partir de YYYY-MM-DD. */
const dayMonth = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** O aviso de vencimento de uma despesa fixa. Sem chave Pix, sem nada além do que o aviso diz. */
export function buildReminderNotice(i: ReminderItem): Notice {
	const when = i.lead === 0 ? "vence hoje" : `vence em ${i.lead} dias, no dia ${dayMonth(i.dueDate)}`;
	const whenShort = i.lead === 0 ? "vence hoje" : `vence em ${i.lead} dias`;
	const label = i.exists
		? i.others
			? i.own
				? "Falta pagar, sua parte e de quem você cuida"
				: "Falta pagar da parte de quem você cuida"
			: "Falta pagar"
		: i.others
			? i.own
				? "Sua parte e de quem você cuida"
				: "Parte de quem você cuida"
			: "Sua parte";
	const money = formatBRL(i.amountCents);
	return {
		uid: i.uid,
		title: "Lembrete de vencimento",
		subject: fitSubject((d) => `Lembrete: "${d}" ${whenShort} · ${money}`, i.description),
		body: `"${clip(i.description)}" (${clip(i.groupName, 40)}) ${when}. ${label}: ${money}`,
		url: i.expenseId ? `/app/grupos/${i.groupId}/despesas/${i.expenseId}` : `/app/grupos/${i.groupId}`,
		scope: { kind: "group", name: i.groupName },
		amountCents: i.amountCents,
		amountLabel: label,
	};
}
