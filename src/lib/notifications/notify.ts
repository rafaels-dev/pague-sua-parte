import type { Db } from "mongodb";
import { describeError } from "@/lib/api/http";
import { EmailError, emailConfigured, renderEmail, sendEmail } from "./email";
import { normalizeNotifyPrefs } from "./prefs";
import { pushConfigured, sendPush } from "./push";
import { removeEndpoints, subscriptionsCollection } from "./subscriptions";
import type { Notice } from "./types";

/** Poucos envios ao mesmo tempo: no máximo 2 e-mails em paralelo (o Mailgun aceita muito mais; é só cautela). */
export const EMAIL_CONCURRENCY = 2;
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

/** Uma nova tentativa quando o serviço responde 429, se couber no tempo total. */
export async function sendEmailWithRetry(send: () => Promise<unknown>, deadline: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
	try {
		await send();
	} catch (err) {
		if (!(err instanceof EmailError) || err.status !== 429) throw err;
		const wait = Math.min((err.retryAfter ?? 1) * 1000, MAX_RETRY_WAIT_MS);
		if (Date.now() + wait >= deadline) throw err;
		await sleep(wait);
		await send();
	}
}

type NotifyUser = { _id: string; email?: string; emailVerified?: boolean; notify?: { email?: boolean; push?: boolean } };

/**
 * Envia cada aviso pelos canais ligados do destinatário (e-mail verificado; push em cada aparelho inscrito).
 * Nunca lança: falha de um canal só vai para o log (nome e mensagem curta, sem endereços nem dados pessoais).
 */
export async function notify(db: Db, notices: Notice[]): Promise<void> {
	try {
		const wantEmail = emailConfigured();
		const wantPush = pushConfigured();
		if (notices.length === 0 || (!wantEmail && !wantPush)) return;
		const uids = [...new Set(notices.map((n) => n.uid))];
		const users = new Map(
			(await db.collection<NotifyUser>("users").find({ _id: { $in: uids } }, { projection: { email: 1, emailVerified: 1, notify: 1 } }).toArray()).map((u) => [u._id, u]),
		);
		const subs = new Map<string, { endpoint: string; keys: { p256dh: string; auth: string } }[]>();
		if (wantPush) {
			for (const s of await subscriptionsCollection(db).find({ uid: { $in: uids } }).toArray()) subs.set(s.uid, [...(subs.get(s.uid) ?? []), s]);
		}
		const gone: string[] = [];
		const emailTasks: (() => Promise<unknown>)[] = [];
		const pushJobs: Promise<unknown>[] = [];
		const deadline = Date.now() + EMAIL_BUDGET_MS;
		for (const n of notices) {
			const u = users.get(n.uid);
			if (!u) continue;
			const prefs = normalizeNotifyPrefs(u.notify);
			if (wantEmail && prefs.email && u.email && u.emailVerified === true) {
				const to = u.email;
				emailTasks.push(async () => {
					try {
						const rendered = await renderEmail(n); // uma vez só, mesmo que o envio precise de nova tentativa
						await sendEmailWithRetry(() => sendEmail(to, n, process.env, rendered), deadline);
					} catch (e) {
						console.error("notify email error:", describeError(e));
					}
				});
			}
			if (wantPush && prefs.push && !n.emailOnly) {
				for (const s of subs.get(n.uid) ?? []) {
					pushJobs.push(
						sendPush(s, n)
							.then((r) => {
								if (r === "gone") gone.push(s.endpoint);
							})
							.catch((e) => console.error("notify push error:", describeError(e))),
					);
				}
			}
		}
		await Promise.all([runPool(emailTasks, EMAIL_CONCURRENCY), ...pushJobs]);
		await removeEndpoints(db, gone);
	} catch (err) {
		console.error("notify error:", describeError(err));
	}
}
