import type { InboxItem } from "@/lib/notifications/inbox";

export type { InboxItem };

const TZ = "America/Sao_Paulo";

/** Texto da bolinha do sininho: vazio em zero; de 10 para cima (o servidor conta até 10) "9+". */
export function badgeLabel(unseen: number): string {
	if (!Number.isFinite(unseen) || unseen <= 0) return "";
	return unseen > 9 ? "9+" : String(Math.floor(unseen));
}

/** Nome acessível do sininho. */
export function bellLabel(unseen: number): string {
	const n = Math.max(0, Math.floor(unseen));
	if (n === 0) return "Avisos";
	if (n > 9) return "Avisos, mais de 9 não lidos";
	return `Avisos, ${n} ${n === 1 ? "não lido" : "não lidos"}`;
}

/** Dia civil em São Paulo ("2026-11-13"). */
export function dayKeySP(d: Date): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type InboxGroup = { label: "Hoje" | "Ontem" | "Antes"; items: InboxItem[] };

/** Em que grupo cai um instante: Hoje, Ontem (o dia civil anterior em São Paulo) ou Antes. */
export function dayLabel(iso: string, now: Date): InboxGroup["label"] {
	const today = dayKeySP(now);
	// Meio-dia de hoje em São Paulo (UTC-3) menos 24 h cai sempre no dia anterior, sem erro de virada.
	const yesterday = dayKeySP(new Date(new Date(`${today}T15:00:00Z`).getTime() - DAY_MS));
	const k = dayKeySP(new Date(iso));
	return k === today ? "Hoje" : k === yesterday ? "Ontem" : "Antes";
}

/** Agrupa (na ordem dada, do mais novo ao mais antigo) por dia em São Paulo: Hoje, Ontem e Antes. Grupos vazios não aparecem. */
export function groupByDay(items: InboxItem[], now: Date): InboxGroup[] {
	const groups: InboxGroup[] = [
		{ label: "Hoje", items: [] },
		{ label: "Ontem", items: [] },
		{ label: "Antes", items: [] },
	];
	for (const it of items) groups.find((g) => g.label === dayLabel(it.createdAt, now))!.items.push(it);
	return groups.filter((g) => g.items.length > 0);
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });

/** Quando, em texto simples: "agora", "há 5 min", "há 2 h", "ontem, 14:30" ou "08/11, 09:15". */
export function relativeTime(iso: string, now: Date): string {
	const d = new Date(iso);
	const diff = now.getTime() - d.getTime();
	if (diff < 60_000) return "agora";
	if (diff < 3_600_000 && dayKeySP(d) === dayKeySP(now)) return `há ${Math.floor(diff / 60_000)} min`;
	if (dayKeySP(d) === dayKeySP(now)) return `há ${Math.floor(diff / 3_600_000)} h`;
	return dayLabel(iso, now) === "Ontem" ? `ontem, ${timeFmt.format(d)}` : `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

/** Pode buscar o contador agora? Só depois do intervalo mínimo desde a última busca. */
export function canFetchCount(now: number, last: number, minMs: number): boolean {
	return now - last >= minMs;
}
