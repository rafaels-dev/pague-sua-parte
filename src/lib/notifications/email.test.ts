import { afterEach, describe, expect, it, vi } from "vitest";
import { appLink, buildEmailText, ctaLabel, emailSubject, highlight, oneLine } from "./email-content";
import { SAMPLE_NOTICES } from "./email-samples";
import { renderNoticeEmail } from "./email-template";
import { appBaseUrl, EmailError, emailConfigured, rateLimitWait, renderEmail, sendEmail } from "./email";
import { sendEmailWithRetry } from "./notify";
import type { Notice } from "./types";

const BASE = "https://x.test";
const hostile: Notice = {
	uid: "u",
	title: "Nova despesa\r\nBcc: ladrao@x.test",
	body: '<script>alert(1)</script> "Ana" & Cia\nsegunda linha',
	url: "/app/receber",
	scope: { kind: "group", name: "<img src=x onerror=alert(1)>" },
	amountCents: 1234,
};

describe("render dos templates", () => {
	for (const { id, notice } of SAMPLE_NOTICES) {
		it(`${id}: título, corpo, link absoluto, texto puro e rodapé`, async () => {
			const { html, text, subject } = await renderNoticeEmail(notice, BASE);
			const body = notice.body.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
			expect(html).toContain(`lang="pt-BR"`);
			expect(html).toContain(notice.title);
			expect(html).toContain(body);
			expect(html).toContain(`href="${BASE}${notice.url}"`);
			expect(html).toContain(`href="${BASE}/app/perfil"`);
			expect(html).toContain(`src="${BASE}/icon-192.png"`);
			expect(html).toContain("color-scheme");
			expect(html).toContain("prefers-color-scheme: dark");
			expect(html).toMatch(/<img[^>]*alt=/);
			expect(html).not.toMatch(/\.svg|data:image|display:\s*flex|display:\s*grid/);
			expect(text).toContain(notice.title);
			expect(text).toContain(notice.body);
			expect(text).toContain(`${BASE}${notice.url}`);
			expect(text).toContain("Mudar meus avisos");
			expect(text).not.toMatch(/<[a-z]/i);
			expect(subject).toBe(notice.title);
			expect(`${html}${text}`.toLowerCase()).not.toMatch(id === "boas-vindas" ? /pix key|00020126/ : /chave pix|pix key|00020126/); // só a boas-vindas manda cadastrar a chave (nunca traz uma)
		});
	}

	it("escapa HTML vindo de usuário e não deixa quebra de linha no assunto nem no texto", async () => {
		const { html, text, subject } = await renderNoticeEmail(hostile, BASE);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;script&gt;");
		expect(subject).not.toMatch(/[\r\n]/);
		expect(subject).toBe("Nova despesa Bcc: ladrao@x.test");
		expect(text.split("\n").filter((l) => l.startsWith("Bcc:"))).toEqual([]);
		expect(text).toContain("segunda linha");
	});

	it("só aponta para o endereço do app", async () => {
		const { html, text } = await renderNoticeEmail({ ...hostile, url: "//evil.test/x" }, BASE);
		const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs.length).toBeGreaterThan(0);
		for (const h of hrefs) expect(h.startsWith(BASE)).toBe(true);
		expect(text).not.toContain("evil.test");
		expect(appLink(BASE, "https://evil.test")).toBe(BASE);
		expect(appLink(BASE, "/\\evil.test")).toBe(BASE);
	});

	it("destaca o valor só quando há valor, e a ação muda com o destino", async () => {
		expect(highlight({ amountCents: 6340, amountLabel: "Sua parte" })).toEqual({ label: "Sua parte", value: expect.stringContaining("63,40") });
		expect(highlight({})).toBeNull();
		expect(highlight({ amountCents: 6340 })).toBeNull(); // sem legenda, sem caixa de valor
		expect(highlight({ amountLabel: "Valor", amountCents: 0 })).toBeNull();
		expect(ctaLabel("/app/grupos/g/despesas/e")).toBe("Ver a despesa");
		expect(ctaLabel("/app/planos/p")).toBe("Ver o plano");
		expect(ctaLabel("/app/grupos/g")).toBe("Ver o grupo");
		const { html } = await renderNoticeEmail(SAMPLE_NOTICES[0].notice, BASE);
		expect(html).not.toContain("Sua parte");
	});

	it("rodapé diz de onde vem o aviso; sem grupo, diz que é da conta", () => {
		expect(buildEmailText({ ...hostile, scope: { kind: "plan", name: "Festa" } }, BASE)).toContain("participa do plano Festa");
		expect(buildEmailText({ ...hostile, scope: undefined }, BASE)).toContain("tem conta no PagueSuaParte");
	});

	it("assunto curto e de uma linha", () => {
		expect(emailSubject("a".repeat(300)).length).toBeLessThanOrEqual(100);
		expect(emailSubject("  \n ")).toBe("Aviso do PagueSuaParte");
		expect(oneLine("a b\tc")).toBe("a b c");
		expect(oneLine("a\u202eb\u2066c\u200fd\u200ee\u2069f")).toBe("a b c d e f");
	});
});

describe("canal de e-mail (Mailgun)", () => {
	afterEach(() => vi.restoreAllMocks());
	const notice: Notice = { uid: "u", title: "Nova despesa", body: "corpo", url: "/app/x" };
	const env = { MAILGUN_SENDING_KEY: "chave-teste", MAILGUN_DOMAIN: "mg.x.test", EMAIL_FROM: "A <a@mg.x.test>", APP_URL: "https://x.test/" } as unknown as NodeJS.ProcessEnv;
	const e = (o: Record<string, string | undefined>) => ({ ...env, ...o }) as unknown as NodeJS.ProcessEnv;
	const form = (f: ReturnType<typeof vi.spyOn>, n = 0) => new URLSearchParams((f.mock.calls[n][1] as RequestInit).body as string);

	it("sem chave, domínio válido ou remetente não faz nada nem chama a rede", async () => {
		const f = vi.spyOn(globalThis, "fetch");
		for (const bad of [{}, { MAILGUN_SENDING_KEY: undefined }, { MAILGUN_DOMAIN: undefined }, { EMAIL_FROM: undefined }, { MAILGUN_DOMAIN: "x.test/../v4" }, { MAILGUN_DOMAIN: "x.test?a=b" }, { MAILGUN_DOMAIN: "a b.test" }, { MAILGUN_DOMAIN: "semponto" }, { MAILGUN_DOMAIN: "evil.test@host.com" }]) {
			expect(await sendEmail("a@b.com", notice, Object.keys(bad).length ? e(bad) : ({} as NodeJS.ProcessEnv))).toBe(false);
		}
		expect(f).not.toHaveBeenCalled();
		expect(emailConfigured({} as NodeJS.ProcessEnv)).toBe(false);
		expect(emailConfigured(env)).toBe(true);
	});

	it("manda para a API do Mailgun (EUA por padrão), com autenticação básica no cabeçalho e rastreio desligado", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		expect(await sendEmail("p@q.com", notice, env)).toBe(true);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe("https://api.mailgun.net/v3/mg.x.test/messages");
		expect(String(url)).not.toContain("chave-teste");
		const req = init as RequestInit;
		expect(req.method).toBe("POST");
		expect((req.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("api:chave-teste").toString("base64")}`);
		expect((req.headers as Record<string, string>)["Content-Type"]).toContain("application/x-www-form-urlencoded");
		const b = form(f);
		expect(b.get("from")).toBe("A <a@mg.x.test>");
		expect(b.get("to")).toBe("p@q.com");
		expect(b.get("subject")).toBe("Nova despesa");
		expect(b.get("html")).toContain('href="https://x.test/app/x"');
		expect(b.get("text")).toContain("https://x.test/app/x");
		expect(b.get("o:tracking")).toBe("no");
		expect(b.get("o:tracking-opens")).toBe("no");
		expect(b.get("o:tracking-clicks")).toBe("no");
		expect(req.body as string).not.toContain("chave-teste");
	});

	it("região: eu troca para o host europeu; qualquer outro valor fica nos EUA (nunca host vindo da variável)", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
		await sendEmail("p@q.com", notice, e({ MAILGUN_REGION: "eu" }));
		await sendEmail("p@q.com", notice, e({ MAILGUN_REGION: "EU " }));
		await sendEmail("p@q.com", notice, e({ MAILGUN_REGION: "evil.test" }));
		await sendEmail("p@q.com", notice, e({ MAILGUN_REGION: "us" }));
		expect(f.mock.calls.map((c) => c[0])).toEqual([
			"https://api.eu.mailgun.net/v3/mg.x.test/messages",
			"https://api.eu.mailgun.net/v3/mg.x.test/messages",
			"https://api.mailgun.net/v3/mg.x.test/messages",
			"https://api.mailgun.net/v3/mg.x.test/messages",
		]);
	});

	it("codifica acentos, emoji, & e = e tira quebras de linha de assunto, remetente e destinatário", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		const n: Notice = { ...notice, title: "Ação & café = ok 🎉\r\nBcc: x@y.test", body: "João & Maria = 50%\n+ mais" };
		await sendEmail("p@q.com", n, e({ EMAIL_FROM: "Pagô & Cia <a@mg.x.test>\nX: y" }));
		const raw = (f.mock.calls[0][1] as RequestInit).body as string;
		expect(raw).not.toMatch(/[\r\n]/);
		const b = form(f);
		expect(b.get("subject")).toBe("Ação & café = ok 🎉 Bcc: x@y.test");
		expect(b.get("from")).toBe("Pagô & Cia <a@mg.x.test> X: y");
		expect(b.get("to")).toBe("p@q.com");
		expect(b.get("html")).toContain("João &amp; Maria = 50%");
		expect(b.get("text")).toContain("João & Maria = 50%");
		expect([...b.keys()].sort()).toEqual(["from", "html", "o:tracking", "o:tracking-clicks", "o:tracking-opens", "subject", "text", "to"]);
	});

	it("só envia para UM endereço: lista, espaço, <> ou aspas não saem e o log não traz o endereço", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		for (const bad of ["a@b.com,c@d.com", "a@b.com;c@d.com", "a@b.com c@d.com", "Fulano <a@b.com>", '"a"@b.com', "a@b.com\r\nBcc: z@y.test", "semarroba", ""]) {
			expect(await sendEmail(bad, notice, env), bad).toBe(false);
		}
		expect(f).not.toHaveBeenCalled();
		expect(JSON.stringify(log.mock.calls)).not.toMatch(/@/);
		expect(await sendEmail("ok+tag@dominio.com.br", notice, env)).toBe(true);
	});

	it("espera do 429: milissegundos Unix, segundos Unix e Retry-After, sempre entre 1 e 60 s", () => {
		const now = 1_800_000_000_000;
		const h = (o: Record<string, string>) => ({ headers: new Headers(o) });
		expect(rateLimitWait(h({ "x-ratelimit-reset": String(now + 2500) }), now)).toBe(3);
		expect(rateLimitWait(h({ "x-ratelimit-reset": String(now / 1000 + 5) }), now)).toBe(5);
		expect(rateLimitWait(h({ "x-ratelimit-reset": String(now + 3_600_000) }), now)).toBe(60);
		expect(rateLimitWait(h({ "x-ratelimit-reset": String(now - 5000) }), now)).toBeUndefined();
		expect(rateLimitWait(h({ "x-ratelimit-reset": "abc" }), now)).toBeUndefined();
		expect(rateLimitWait(h({ "retry-after": "2" }), now)).toBe(2);
		expect(rateLimitWait(h({ "retry-after": "-3" }), now)).toBeUndefined();
		expect(rateLimitWait(h({ "retry-after": "99999" }), now)).toBe(60);
		expect(rateLimitWait(h({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }), now)).toBeUndefined();
		expect(rateLimitWait(h({}), now)).toBeUndefined();
	});

	it("usa o resultado já renderizado, sem renderizar de novo", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		await sendEmail("p@q.com", notice, env, { subject: "s", html: "<p>h</p>", text: "t" });
		expect(form(f).get("html")).toBe("<p>h</p>");
	});

	it("429: EmailError com a espera pedida, sem corpo, chave nem destinatário na mensagem", async () => {
		const reset = String(Date.now() + 3500);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("segredo p@q.com", { status: 429, headers: { "x-ratelimit-reset": reset } }));
		const err = await sendEmail("p@q.com", notice, env).catch((x) => x);
		expect(err).toBeInstanceOf(EmailError);
		expect(err.status).toBe(429);
		expect(err.retryAfter).toBeGreaterThanOrEqual(3);
		expect(err.retryAfter).toBeLessThanOrEqual(4);
		expect(String(err.message)).not.toMatch(/segredo|p@q\.com|chave-teste|mg\.x\.test/);
	});

	it("429 com nova tentativa: renderiza uma vez e envia duas", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
		const rendered = await renderEmail(notice, env);
		await sendEmailWithRetry(() => sendEmail("p@q.com", notice, env, rendered), Date.now() + 10_000, async () => {});
		expect(f).toHaveBeenCalledTimes(2);
		expect(form(f, 0).get("html")).toBe(form(f, 1).get("html"));
	});

	it("outros erros (401, 400, 500) viram EmailError sem repetir", async () => {
		for (const status of [401, 400, 500]) {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response('{"message":"x p@q.com"}', { status }));
			const err = await sendEmail("p@q.com", notice, env).catch((x) => x);
			expect(err).toMatchObject({ name: "EmailError", status });
			expect(err.retryAfter).toBeUndefined();
		}
	});

	it("appBaseUrl tira a barra final", () => expect(appBaseUrl({ APP_URL: "https://x.test/" } as unknown as NodeJS.ProcessEnv)).toBe("https://x.test"));
});
