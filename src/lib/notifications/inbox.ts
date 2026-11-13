import { ObjectId, type Db } from "mongodb";
import { describeError } from "@/lib/api/http";
import { isManagedUid } from "@/lib/groups/helpers";
import type { Notice } from "./types";

/**
 * Caixa de avisos: o mesmo texto que vai no push, guardado por pessoa, para ler depois no sininho.
 * Um documento por aviso por pessoa. NUNCA guarda chave Pix, referência de comprovante, e-mail, assunto de e-mail nem HTML:
 * os campos abaixo são montados um a um (nada de espalhar o `Notice` inteiro).
 */
export type InboxDoc = {
	_id: ObjectId;
	uid: string;
	title: string;
	body: string;
	/** Sempre um caminho interno (`/app...` ou `/convite/...`). */
	url: string;
	createdAt: Date;
	readAt?: Date;
};

export type InboxItem = { id: string; title: string; body: string; url: string; createdAt: string; read: boolean };

/** Folga do corte devolvido pela lista: um insert que termina logo depois da leitura ainda conta como não visto. */
export const SEEN_SLACK_MS = 10_000;
export const INBOX_PAGE_SIZE = 30;
/** O contador conta no máximo isto (a tela mostra "9+"). */
export const UNSEEN_CAP = 10;
/** Quanto tempo a caixa guarda um aviso (TTL no índice de `createdAt`). */
export const INBOX_RETENTION_DAYS = 90;

export const inboxCollection = (db: Db) => db.collection<InboxDoc>("inbox");

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/**
 * Só caminhos internos: `/app`, `/app/...` ou `/convite/...`. Um endereço absoluto do próprio app vira só o caminho;
 * qualquer outra coisa (outro site, `//`, barra invertida, `..`, espaço ou caractere de controle) vira `/app`.
 */
export function safeInboxUrl(raw: unknown, appUrl?: string): string {
	if (typeof raw !== "string") return "/app";
	let url = raw;
	if (appUrl && /^https?:\/\//i.test(url)) {
		try {
			const base = new URL(appUrl);
			const u = new URL(url);
			if (u.origin !== base.origin) return "/app";
			url = `${u.pathname}${u.search}`;
		} catch {
			return "/app";
		}
	}
	if (url.length > 500 || url.includes("#")) return "/app";
	if (/[\\\s\u0000-\u001f\u007f]/.test(url)) return "/app";
	const q = url.indexOf("?");
	const path = q === -1 ? url : url.slice(0, q);
	// No caminho, nada de `//`, `..` nem forma codificada de ponto, barra ou barra invertida (o navegador normalizaria e sairia da pasta).
	if (path.includes("//") || path.includes("..") || /%(2e|2f|5c)/i.test(path)) return "/app";
	if (path === "/app" || path.startsWith("/app/") || path.startsWith("/convite/")) return url;
	return "/app";
}

/** Os documentos da caixa para os avisos que vão ao push (boas-vindas, só e-mail, ficam de fora). */
export function toInboxDocs(notices: Notice[], now: Date, appUrl?: string): Omit<InboxDoc, "_id">[] {
	return notices
		.filter((n) => !n.emailOnly && !isManagedUid(n.uid)) // pessoa cuidada não tem login: nunca tem caixa
		.map((n) => {
			return { uid: n.uid, title: clip(n.title, 200), body: clip(n.body, 600), url: safeInboxUrl(n.url, appUrl), createdAt: now };
		});
}

/**
 * Começa a gravar os avisos na caixa (uma ida só, `insertMany` sem ordem) e devolve uma promessa que NUNCA rejeita: falha só vai para o log
 * (nome e mensagem curta, sem dados). `createdAt` é o instante do insert (calculado aqui, na hora de gravar). Não espera nada:
 * quem chama decide se e quanto espera (`waitInbox`).
 */
export function startInbox(db: Db, notices: Notice[], opts: { now?: Date; appUrl?: string } = {}): Promise<void> & { settled?: boolean } {
	const out: Promise<void> & { settled?: boolean } = (() => {
		try {
			const docs = toInboxDocs(notices, opts.now ?? new Date(), opts.appUrl ?? process.env.APP_URL);
			if (docs.length === 0) return Promise.resolve();
			return Promise.resolve(inboxCollection(db).insertMany(docs as InboxDoc[], { ordered: false })).then(
				() => undefined,
				(err) => console.error("inbox error:", describeError(err)),
			);
		} catch (err) {
			console.error("inbox error:", describeError(err));
			return Promise.resolve();
		}
	})();
	void out.then(() => {
		out.settled = true;
	});
	return out;
}

/** Teto de espera pela gravação (com ou sem prazo). */
export const INBOX_WAIT_MS = 2_000;

/**
 * Espera a gravação, no máximo `min(prazo restante, 2 s)` (sem piso: prazo vencido não espera; sem prazo, 2 s). Nunca lança.
 * Se a gravação ainda não acabou, loga uma linha fixa só com a contagem (sem dados pessoais).
 */
export async function waitInbox(pending: (Promise<void> & { settled?: boolean }) | undefined, deadline?: number, count = 0): Promise<void> {
	if (!pending) return;
	const ms = Math.min(deadline === undefined ? INBOX_WAIT_MS : deadline - Date.now(), INBOX_WAIT_MS);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		if (ms > 0) await Promise.race([pending, new Promise<void>((r) => (timer = setTimeout(r, ms)))]);
	} finally {
		clearTimeout(timer);
	}
	if (!pending.settled) console.error(`inbox: ${count} avisos ainda sem gravar quando o prazo acabou`);
}

/** Começa e espera (dentro do prazo). Atalho para quem não tem mais nada para fazer em paralelo. */
export async function recordInbox(db: Db, notices: Notice[], opts: { deadline?: number; now?: Date; appUrl?: string } = {}): Promise<void> {
	await waitInbox(startInbox(db, notices, opts), opts.deadline, notices.length);
}

const ID = /^[0-9a-f]{24}$/i;
export const isInboxId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export function toInboxItem(d: InboxDoc, appUrl?: string): InboxItem {
	return { id: d._id.toHexString(), title: d.title, body: d.body, url: safeInboxUrl(d.url, appUrl), createdAt: d.createdAt.toISOString(), read: d.readAt !== undefined };
}

/** Quantos avisos chegaram depois de a pessoa abrir a lista pela última vez (no máximo `UNSEEN_CAP`). */
export async function countUnseen(db: Db, uid: string): Promise<number> {
	const u = await db.collection<{ _id: string; inboxSeenAt?: Date }>("users").findOne({ _id: uid }, { projection: { inboxSeenAt: 1 } });
	const filter = u?.inboxSeenAt ? { uid, createdAt: { $gt: u.inboxSeenAt } } : { uid };
	return inboxCollection(db).countDocuments(filter, { limit: UNSEEN_CAP });
}

/**
 * Corte devolvido pela lista: `max(createdAt do aviso mais novo listado, agora - 10 s)`, nunca maior que agora (relógio de outra instância).
 * Todo aviso que apareceu na lista conta como visto; a folga protege o insert atrasado quando o mais novo da lista é antigo.
 * Milissegundos preservados (a contagem usa `createdAt > inboxSeenAt`).
 */
export function listCutoff(docs: { createdAt: Date }[], now: Date): Date {
	const slack = now.getTime() - SEEN_SLACK_MS;
	const newest = docs.reduce((m, d) => Math.max(m, d.createdAt.getTime()), -Infinity);
	return new Date(Math.min(now.getTime(), Math.max(newest, slack)));
}

/**
 * Os mais recentes da própria pessoa, o contador e `seenUpTo`: o instante do servidor ANTES da leitura. O cliente o devolve em `seen`,
 * assim o aviso que chega entre a leitura e o toque nunca é dado como visto sem ter aparecido.
 */
export async function listInbox(db: Db, uid: string, appUrl?: string, now = new Date()): Promise<{ items: InboxItem[]; unseen: number; seenUpTo: string }> {
	const [docs, unseen] = await Promise.all([
		inboxCollection(db).find({ uid }).sort({ createdAt: -1 }).limit(INBOX_PAGE_SIZE).toArray(),
		countUnseen(db, uid),
	]);
	return { items: docs.map((d) => toInboxItem(d, appUrl)), unseen, seenUpTo: listCutoff(docs, now).toISOString() };
}

/** O corte válido: `min(upTo, agora)`; sem `upTo`, agora. */
export const seenCutoff = (upTo: Date | undefined, now: Date) => (upTo && upTo.getTime() < now.getTime() ? upTo : now);

/** Marca como visto o que chegou até `upTo` (limitado a agora). Nunca retrocede `inboxSeenAt`. */
export async function markSeen(db: Db, uid: string, upTo?: Date, now = new Date()): Promise<void> {
	const cut = seenCutoff(upTo, now);
	await db.collection<{ _id: string; inboxSeenAt?: Date }>("users").updateOne(
		{ _id: uid, $or: [{ inboxSeenAt: { $exists: false } }, { inboxSeenAt: { $lt: cut } }] },
		{ $set: { inboxSeenAt: cut } },
	);
}

/** Marca um aviso da própria pessoa como lido. Id alheio ou inexistente não faz nada (e não revela nada). */
export async function markRead(db: Db, uid: string, id: string, now = new Date()): Promise<void> {
	await inboxCollection(db).updateOne({ _id: new ObjectId(id), uid, readAt: { $exists: false } }, { $set: { readAt: now } });
}

export async function markAllRead(db: Db, uid: string, now = new Date()): Promise<void> {
	await inboxCollection(db).updateMany({ uid, readAt: { $exists: false } }, { $set: { readAt: now } });
}
