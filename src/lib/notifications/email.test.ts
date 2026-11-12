import { describe, expect, it, vi } from "vitest";
import { appBaseUrl, buildEmail, escapeHtml, sendEmail } from "./email";

describe("buildEmail", () => {
	it("escapa HTML de nomes e descrições e leva link e rodapé", () => {
		const { html, text, subject } = buildEmail({ title: "Nova despesa", body: '<script>alert(1)</script> "Ana" & Cia', url: "/app/receber" }, "https://x.test");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain('href="https://x.test/app/receber"');
		expect(html).toContain("Para parar de receber, abra Perfil &gt; Avisos.");
		expect(text).toContain("Para parar de receber, abra Perfil > Avisos.");
		expect(text).toContain("https://x.test/app/receber");
		expect(subject).toBe("Nova despesa");
	});
	it("escapeHtml cobre aspas", () => expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;"));
});

describe("canal de e-mail", () => {
	it("sem as variáveis não faz nada nem chama a rede", async () => {
		const f = vi.spyOn(globalThis, "fetch");
		expect(await sendEmail("a@b.com", { uid: "u", title: "t", body: "b", url: "/" }, {} as NodeJS.ProcessEnv)).toBe(false);
		expect(f).not.toHaveBeenCalled();
		f.mockRestore();
	});
	it("com as variáveis chama o Resend", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		const env = { RESEND_API_KEY: "k", EMAIL_FROM: "A <a@b.com>", APP_URL: "https://x.test/" } as unknown as NodeJS.ProcessEnv;
		expect(await sendEmail("p@q.com", { uid: "u", title: "t", body: "b", url: "/app" }, env)).toBe(true);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe("https://api.resend.com/emails");
		expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ from: "A <a@b.com>", to: ["p@q.com"] });
		f.mockRestore();
	});
	it("appBaseUrl tira a barra final", () => expect(appBaseUrl({ APP_URL: "https://x.test/" } as unknown as NodeJS.ProcessEnv)).toBe("https://x.test"));
});
