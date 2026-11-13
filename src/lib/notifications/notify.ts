import type { Db } from "mongodb";
import { describeError } from "@/lib/api/http";
import { EmailError, emailConfigured, renderEmail, sendEmail } from "./email";
import { resolveReceiptAttachment, type FileCache } from "./receipt-attachment";
import { startInbox, waitInbox } from "./inbox";
import { normalizeNotifyPrefs } from "./prefs";
import { pushConfigured, sendPush } from "./push";
import { removeEndpoints, subscriptionsCollection } from "./subscriptions";
import type { Notice } from "./types";

/**
 * E-mails em paralelo. Conta para um grupo de 50 pessoas no prazo padrão de 20 s (um envio começa até 17,5 s, `MIN_SEND_MS` de folga):
 * com 5 em paralelo e ~1 s por e-mail (renderizar + Mailgun) são 10 s; mesmo com 2 s por e-mail são 20 s (50/5 × 2), ainda no limite,
 * e o tempo limite de 8 s por envio garante que ninguém trava a fila. Com 2 em paralelo seriam 25 s a 1 s por e-mail: não cabia.
 * O push já sai primeiro e em paralelo (começa no ato, antes de a fila de e-mails andar).
 */
export const EMAIL_CONCURRENCY = 5;
/** Tempo total que o envio pode gastar (inclui a espera da nova tentativa). */
export const EMAIL_BUDGET_MS = 20_000;
const MAX_RETRY_WAIT_MS = 3_000;

/** Roda as tarefas com no máximo `limit` ao mesmo tempo. */
export async function runPool(tasks: (() => Promise<unknown>)[], limit: number): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < tasks.length) await tasks[next++]();
	};
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/** Roda os passos em ordem, cada um com o seu tratamento de erro: um que falha (só o log, sem dados) nunca impede o seguinte. */
export async function runSettledInOrder(steps: (() => Promise<unknown>)[]): Promise<void> {
	for (const step of steps) {
		try {
			await step();
		} catch (err) {
			console.error("notificação error:", describeError(err));
		}
	}
}

/** Uma nova tentativa quando o serviço responde 429, se couber no tempo total. */
export async function sendEmailWithRetry(send: () => Promise<unknown>, deadline: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
	await sendEmailWithRetryResult(send, deadline, sleep);
}

/** Como `sendEmailWithRetry`, devolvendo o que o envio devolveu. A espera só acontece se sobrar tempo para a nova tentativa (`MIN_SEND_MS`). */
export async function sendEmailWithRetryResult<T>(send: () => Promise<T>, deadline: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
	try {
		return await send();
	} catch (err) {
		if (!(err instanceof EmailError) || err.status !== 429) throw err;
		const wait = Math.min((err.retryAfter ?? 1) * 1000, MAX_RETRY_WAIT_MS);
		if (Date.now() + wait + MIN_SEND_MS >= deadline) throw err;
		await sleep(wait);
		return send();
	}
}

type NotifyUser = { _id: string; email?: string; emailVerified?: boolean; notify?: { email?: boolean; push?: boolean } };

/** Com menos que isto do prazo, um envio nem começa (não adianta: a resposta não chegaria a tempo). */
export const MIN_SEND_MS = 2_500;

/** Resultado de uma chamada: quantos avisos chegaram a algum canal e quantos falharam em TODOS os canais tentados (sem dados pessoais). */
export type NotifyReport = { delivered: number; failed: number };

/**
 * Envia cada aviso pelos canais ligados do destinatário (e-mail verificado; push em cada aparelho inscrito).
 * Nunca lança: falha de um canal só vai para o log (nome e mensagem curta, sem endereços nem dados pessoais).
 * `opts.deadline` (instante absoluto, ms) é o prazo de TUDO: nenhum envio começa sem folga e nenhuma espera passa dele.
 * Cada arquivo de comprovante distinto é lido uma vez por chamada, não por destinatário.
 */
export async function notify(db: Db, notices: Notice[], opts: { deadline?: number } = {}): Promise<NotifyReport> {
	const report: NotifyReport = { delivered: 0, failed: 0 };
	// A caixa de avisos (sininho) recebe tudo o que iria ao push, mesmo sem canal configurado e com o envio falhando. Começa já, SEM esperar:
	// push e e-mail saem no ato; só no fim se espera a gravação, e só até o prazo (a promessa nunca rejeita; falha só vai ao log).
	const inbox = notices.length > 0 ? startInbox(db, notices) : undefined;
	try {
		const wantEmail = emailConfigured();
		const wantPush = pushConfigured();
		if (notices.length === 0 || (!wantEmail && !wantPush)) return report;
		const uids = [...new Set(notices.map((n) => n.uid))];
		const users = new Map(
			(await db.collection<NotifyUser>("users").find({ _id: { $in: uids } }, { projection: { email: 1, emailVerified: 1, notify: 1 } }).toArray()).map((u) => [u._id, u]),
		);
		const subs = new Map<string, { endpoint: string; keys: { p256dh: string; auth: string } }[]>();
		// Aviso só de e-mail (boas-vindas) nunca consulta inscrições de push.
		const pushUids = [...new Set(notices.filter((n) => !n.emailOnly).map((n) => n.uid))];
		if (wantPush && pushUids.length > 0) {
			for (const s of await subscriptionsCollection(db).find({ uid: { $in: pushUids } }).toArray()) subs.set(s.uid, [...(subs.get(s.uid) ?? []), s]);
		}
		const gone: string[] = [];
		const emailTasks: (() => Promise<unknown>)[] = [];
		const pushJobs: Promise<unknown>[] = [];
		const deadline = opts.deadline ?? Date.now() + EMAIL_BUDGET_MS;
		const left = () => deadline - Date.now();
		const files: FileCache = new Map();
		const late = { emails: 0, pushes: 0 }; // ficaram de fora por falta de prazo
		const attempted = new Array<boolean>(notices.length).fill(false);
		const ok = new Array<boolean>(notices.length).fill(false);
		notices.forEach((n, i) => {
			const u = users.get(n.uid);
			if (!u) return;
			const prefs = normalizeNotifyPrefs(u.notify);
			if (wantEmail && prefs.email && u.email && u.emailVerified === true) {
				const to = u.email;
				attempted[i] = true;
				emailTasks.push(async () => {
					if (left() < MIN_SEND_MS) {
						late.emails++; // sem folga: nem começa (conta como não entregue)
						return;
					}
					try {
						// O comprovante (se houver, e se este destinatário poderia baixá-lo) vem do cache por arquivo; a permissão é conferida por destinatário.
						const receipt = n.receipts?.length ? await resolveReceiptAttachment(db, n, { deadline, cache: files }) : ({ line: "none" } as const);
						const line = receipt.line === "none" ? undefined : receipt.line;
						const rendered = await renderEmail(n, process.env, line); // uma vez só, mesmo que o envio precise de nova tentativa
						const attachment = receipt.line === "attached" ? receipt.attachment : undefined;
						const send = (r: typeof rendered, a?: typeof attachment) => async () => {
							const t = left();
							if (t < 1_000) {
								late.emails++;
								throw new Error("sem tempo para enviar");
							}
							return sendEmail(to, n, process.env, r, a, t);
						};
						try {
							ok[i] = Boolean(await sendEmailWithRetryResult(send(rendered, attachment), deadline));
						} catch (e) {
							// O serviço recusou o pedido com anexo (400/413): o e-mail sai igual, sem o arquivo, dizendo para ver no app.
							if (!(attachment && e instanceof EmailError && (e.status === 400 || e.status === 413))) throw e;
							const plain = await renderEmail(n, process.env, (n.receiptsOf ?? 1) > 1 ? "app_many" : "app");
							ok[i] = Boolean(await sendEmailWithRetryResult(send(plain), deadline));
						}
					} catch (e) {
						console.error("notify email error:", describeError(e));
					}
				});
			}
			if (wantPush && prefs.push && !n.emailOnly) {
				for (const s of subs.get(n.uid) ?? []) {
					attempted[i] = true;
					if (left() < MIN_SEND_MS) {
						late.pushes++;
						continue;
					}
					pushJobs.push(
						sendPush(s, n, process.env, left())
							.then((r) => {
								if (r === "gone") gone.push(s.endpoint);
								if (r === "sent") ok[i] = true;
							})
							.catch((e) => console.error("notify push error:", describeError(e))),
					);
				}
			}
		});
		await Promise.all([runPool(emailTasks, EMAIL_CONCURRENCY), ...pushJobs]);
		await removeEndpoints(db, gone);
		// Só números, em texto fixo: nada de endereços, nomes nem ids.
		if (late.emails > 0 || late.pushes > 0) console.error(`notify: ${late.emails} e-mails e ${late.pushes} pushes ficaram de fora por falta de prazo`);
		notices.forEach((_n, i) => {
			if (ok[i]) report.delivered++;
			else if (attempted[i]) report.failed++;
		});
	} catch (err) {
		console.error("notify error:", describeError(err));
	} finally {
		await waitInbox(inbox, opts.deadline, notices.length);
	}
	return report;
}

/**
 * Quem tem pelo menos um canal utilizável agora: e-mail ligado, confirmado e com endereço (com o canal configurado), ou push ligado
 * com algum aparelho inscrito (com o canal configurado). Serve para não gastar teto de envio com quem nunca receberia nada.
 */
export async function reachableUids(db: Db, uids: string[]): Promise<Set<string>> {
	const out = new Set<string>();
	const wantEmail = emailConfigured();
	const wantPush = pushConfigured();
	if (uids.length === 0 || (!wantEmail && !wantPush)) return out;
	const users = await db.collection<NotifyUser>("users").find({ _id: { $in: uids } }, { projection: { email: 1, emailVerified: 1, notify: 1 } }).toArray();
	const needPush: string[] = [];
	for (const u of users) {
		const prefs = normalizeNotifyPrefs(u.notify);
		if (wantEmail && prefs.email && u.email && u.emailVerified === true) out.add(u._id);
		else if (wantPush && prefs.push) needPush.push(u._id);
	}
	if (needPush.length > 0) for (const s of await subscriptionsCollection(db).find({ uid: { $in: needPush } }).toArray()) out.add(s.uid);
	return out;
}
