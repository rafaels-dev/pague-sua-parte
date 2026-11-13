import { actsFor, isManagedUid, type MemberLike } from "@/lib/groups/helpers";
import { formatBRL } from "@/lib/money";
import type { NewExpenseFact, NewExpenseMode, Notice, NoticeContext, PaymentFact } from "./types";

/** Aviso em lote ao devedor: "suas" só quando todas são dele; quem só cuida lê "de quem você cuida". */
function debtorBatch(fs: PaymentFact[], recipient: string, n: number, actor: string): string {
	const own = fs.filter((f) => f.debtorUid === recipient).length;
	if (own === n) return `${actor} marcou ${n} partes suas como pagas.`;
	if (own === 0) return `${actor} marcou ${n} partes de quem você cuida como pagas.`;
	return `${actor} marcou ${n} partes como pagas (suas e de quem você cuida).`;
}

/** Legenda do valor em destaque no e-mail, conforme o que o texto do aviso diz. */
function payLabel(type: PayType, batch: boolean, partial: boolean): string {
	if (partial) return "Valor pago agora";
	if (type === "refund") return batch ? "Total devolvido" : "Valor devolvido";
	if (type === "paid") return batch ? "Total recebido" : "Valor recebido";
	return batch ? "Total pago" : "Valor pago";
}

const clip = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A pessoa com login que recebe os avisos de `uid`: ele mesmo, ou quem cuida dele. Fora do grupo: ninguém. */
export function loginOf(members: MemberLike[], uid: string): string | null {
	const m = members.find((x) => x.uid === uid);
	if (!m) return null;
	if (m.kind === "managed") {
		const by = m.managedBy;
		return by && members.some((x) => x.uid === by && x.kind !== "managed") ? by : null;
	}
	return isManagedUid(uid) ? null : uid;
}

const expenseUrl = (groupId: string, expenseId: string) => `/app/grupos/${groupId}/despesas/${expenseId}`;

function dedupe(notices: Notice[]): Notice[] {
	const seen = new Set<string>();
	return notices.filter((n) => {
		const k = JSON.stringify([n.uid, n.title, n.body, n.url]);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

// ---------- entrou no grupo ----------

/** Avisa quem administra o grupo (com login) que `joinerName` entrou. Nunca avisa quem entrou. */
export function buildMemberJoinedNotices(args: {
	groupId: string;
	groupName: string;
	members: MemberLike[];
	joinerUid: string;
	joinerName: string;
}): Notice[] {
	const admins = args.members.filter((m) => m.role === "admin" && m.kind !== "managed" && m.uid !== args.joinerUid);
	return dedupe(
		admins.map((a) => ({
			uid: a.uid,
			title: "Alguém entrou no grupo",
			body: `${args.joinerName} entrou no grupo ${clip(args.groupName)}.`,
			url: `/app/grupos/${args.groupId}`,
			scope: { kind: "group" as const, name: args.groupName },
		})),
	);
}

// ---------- pagamentos e devoluções ----------

type PayType = "paid" | "marked" | "debtor" | "refund";

const PAY_TITLES: Record<PayType, string> = {
	paid: "Pagamento recebido",
	marked: "Parte marcada como paga",
	debtor: "Parte marcada como paga",
	refund: "Devolução recebida",
};

/**
 * Quem deve saber de cada pagamento: quem recebe (ou quem cuida dele), e o devedor quando outra pessoa marcou a parte dele.
 * Nunca quem fez a ação; um aviso por destinatário, tipo e autor (um lote vira uma frase só).
 */
export function buildPaymentNotices(facts: PaymentFact[], ctx: NoticeContext): Notice[] {
	const buckets = new Map<string, { uid: string; type: PayType; actor: string; facts: PaymentFact[] }>();
	const add = (uid: string, type: PayType, f: PaymentFact) => {
		// Pagamento parcial tem texto próprio (quanto entrou e quanto falta) e sempre vem sozinho (uma parte por vez): não se mistura com lotes.
		const key = `${uid}|${type}|${f.actorUid}${f.partial ? `|p|${f.expenseId}|${f.debtorUid}` : ""}`;
		const b = buckets.get(key) ?? { uid, type, actor: f.actorUid, facts: [] };
		b.facts.push(f);
		buckets.set(key, b);
	};
	for (const f of facts) {
		const g = ctx.group(f.groupId);
		if (!g) continue;
		if (f.kind === "refund") {
			const r = loginOf(g.members, f.debtorUid);
			if (r && r !== f.actorUid) add(r, "refund", f);
			continue;
		}
		const payee = loginOf(g.members, f.paidBy);
		// Quem marcou a própria parte (ex.: o administrador) está dizendo que pagou, igual ao "Já paguei".
		if (payee && payee !== f.actorUid) add(payee, f.manual && f.debtorUid !== f.actorUid ? "marked" : "paid", f);
		if (f.manual && !actsFor(g.members, f.actorUid, f.debtorUid)) {
			const d = loginOf(g.members, f.debtorUid);
			if (d && d !== f.actorUid && d !== payee) add(d, "debtor", f);
		}
	}

	const out: Notice[] = [];
	for (const b of buckets.values()) {
		const fs = b.facts;
		const actor = ctx.name(fs[0].groupId, b.actor);
		const total = formatBRL(fs.reduce((t, f) => t + f.amountCents, 0));
		let body: string;
		let url: string;
		if (fs.length === 1) {
			const f = fs[0];
			const where = `"${clip(f.description)}" (${clip(ctx.group(f.groupId)?.name ?? "", 40)})`;
			const debtor = ctx.name(f.groupId, f.debtorUid);
			const m = formatBRL(f.amountCents);
			const part = f.partial;
			const rest = part ? ` Faltam ${formatBRL(part.remainingCents)}.` : "";
			const ofTotal = part ? ` de ${formatBRL(part.shareCents)}` : "";
			const forPayer = b.uid !== f.paidBy && b.type !== "refund" && b.type !== "debtor" ? ` Para ${ctx.name(f.groupId, f.paidBy)}.` : "";
			switch (b.type) {
				case "paid":
					body = `${actor} pagou ${m}${ofTotal}${f.debtorUid === b.actor ? "" : ` da parte de ${debtor}`} em ${where}.${rest}${forPayer}`;
					break;
				case "marked":
					body = part
						? `${actor} registrou ${m}${ofTotal} da parte de ${debtor} em ${where}.${rest}${forPayer}`
						: `${actor} marcou como paga a parte de ${debtor} em ${where}: ${m}.${forPayer}`;
					break;
				case "debtor":
					body = part
						? b.uid === f.debtorUid
							? `${actor} registrou ${m}${ofTotal} da sua parte em ${where}.${rest}`
							: `${actor} registrou ${m}${ofTotal} da parte de ${debtor} em ${where}.${rest}`
						: b.uid === f.debtorUid
							? `${actor} marcou sua parte de ${where} como paga.`
							: `${actor} marcou a parte de ${debtor} em ${where} como paga.`;
					break;
				case "refund":
					body = b.uid === f.debtorUid ? `${actor} devolveu ${m} de ${where}.` : `${actor} devolveu ${m} para ${debtor} em ${where}.`;
					break;
			}
			url = expenseUrl(f.groupId, f.expenseId);
		} else {
			const n = fs.length;
			body = {
				paid: `${actor} pagou ${total} de ${n} contas.`,
				marked: `${actor} marcou ${n} partes como pagas (${total}).`,
				debtor: debtorBatch(fs, b.uid, n, actor),
				refund: `${actor} devolveu ${total} em ${n} contas.`,
			}[b.type];
			url = b.type === "debtor" ? "/app/pagar" : "/app/receber";
		}
		const partial = fs.length === 1 && fs[0].partial && b.type !== "refund";
		// Lote de grupos diferentes: sem nome de grupo no rodapé do e-mail.
		const sameGroup = fs.every((f) => f.groupId === fs[0].groupId);
		const scope = sameGroup ? { kind: "group" as const, name: ctx.group(fs[0].groupId)?.name ?? "" } : undefined;
		out.push({ uid: b.uid, title: partial ? "Pagamento parcial" : PAY_TITLES[b.type], body, url, ...(scope?.name ? { scope } : {}), amountCents: fs.reduce((t, f) => t + f.amountCents, 0), amountLabel: payLabel(b.type, fs.length > 1, Boolean(partial)) });
	}
	return dedupe(out);
}

// ---------- despesa nova ----------

const TITLES: Record<NewExpenseMode, string> = {
	created: "Nova despesa",
	recurring: "Despesa fixa do mês",
	added: "Você entrou numa despesa",
};

/**
 * Quem deve saber de uma despesa nova: cada pessoa com parte (ou quem cuida dela, com o total sob sua responsabilidade).
 * `created`: não avisa quem lançou; se o administrador lançou em nome de outro, esse também é avisado.
 * `recurring`: ninguém é autor; só quem pagou fica de fora. `added`: `f.shares` traz só quem entrou na divisão.
 */
export function buildNewExpenseNotices(f: NewExpenseFact, mode: NewExpenseMode, ctx: NoticeContext): Notice[] {
	const g = ctx.group(f.groupId);
	if (!g) return [];
	const exclude = new Set<string>();
	if (mode === "recurring") {
		const payer = loginOf(g.members, f.paidBy);
		if (payer) exclude.add(payer);
		if (f.actorUid) exclude.add(f.actorUid); // quem acabou de criar o modelo
	} else if (f.actorUid) exclude.add(f.actorUid);

	const parts = new Map<string, { cents: number; others: boolean }>();
	for (const s of f.shares) {
		if (s.amountCents <= 0 || s.uid === f.paidBy) continue;
		const r = loginOf(g.members, s.uid);
		if (!r || exclude.has(r)) continue;
		const p = parts.get(r) ?? { cents: 0, others: false };
		p.cents += s.amountCents;
		if (r !== s.uid) p.others = true;
		parts.set(r, p);
	}
	let onBehalf: string | null = null;
	if (mode === "created" && f.actorUid && f.paidBy !== f.actorUid && !actsFor(g.members, f.actorUid, f.paidBy)) {
		const r = loginOf(g.members, f.paidBy);
		if (r && !exclude.has(r)) onBehalf = r;
	}

	const actor = f.actorUid ? ctx.name(f.groupId, f.actorUid) : "";
	const desc = `"${clip(f.description)}"`;
	const group = clip(g.name, 40);
	const url = expenseUrl(f.groupId, f.expenseId);
	const out: Notice[] = [];
	for (const r of new Set([...parts.keys(), ...(onBehalf ? [onBehalf] : [])])) {
		const p = parts.get(r);
		const label = `${p?.others ? "Sua parte e de quem você cuida" : "Sua parte"}${f.installments ? (f.installmentsDiffer ? " na primeira parcela" : " em cada parcela") : ""}`;
		const part = p ? ` ${label}: ${formatBRL(p.cents)}` : "";
		if (r === onBehalf) {
			// Quem cuida do pagador (pessoa sem login) precisa ler de quem é a despesa.
			const whose = r === f.paidBy ? "em seu nome" : `em nome de ${ctx.name(f.groupId, f.paidBy)}`;
			out.push({ uid: r, title: r === f.paidBy ? "Despesa lançada em seu nome" : "Despesa lançada em nome de quem você cuida", body: `${actor} lançou uma despesa ${whose}: ${desc}${f.installmentsDiffer ? "" : `, ${formatBRL(f.amountCents)}`}.${part}`, url, scope: { kind: "group", name: g.name }, ...(p ? { amountCents: p.cents, amountLabel: label } : {}) });
			continue;
		}
		const base =
			mode === "recurring"
				? `Nova despesa fixa: ${desc} no grupo ${group}.`
				: mode === "added"
					? `${actor} incluiu ${p?.others ? "quem você cuida" : "você"} em ${desc} no grupo ${group}.`
					: `${actor} lançou ${desc}${f.installments ? ` em ${f.installments} parcelas` : ""} no grupo ${group}.`;
		out.push({ uid: r, title: TITLES[mode], body: `${base}${part}`, url, scope: { kind: "group", name: g.name }, ...(p ? { amountCents: p.cents, amountLabel: label } : {}) });
	}
	return dedupe(out);
}
