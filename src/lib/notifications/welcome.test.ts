import { describe, expect, it } from "vitest";
import { buildEmailText } from "./email-content";
import { renderNoticeEmail } from "./email-template";
import { buildWelcomeNotice, firstName } from "./welcome";

describe("boas-vindas", () => {
	it("cumprimenta pelo primeiro nome (apelido do perfil primeiro) e funciona sem nome", () => {
		expect(buildWelcomeNotice({ uid: "u", name: "Maria Souza" }).title).toBe("Que bom ter você aqui, Maria");
		expect(buildWelcomeNotice({ uid: "u", name: "Maria Souza", displayName: "Mari" }).title).toBe("Que bom ter você aqui, Mari");
		expect(buildWelcomeNotice({ uid: "u", name: "  " }).title).toBe("Que bom ter você aqui");
		expect(firstName({ name: "João\r\nBcc: x" })).toBe("João");
	});
	it("só e-mail, aponta para /app, sem valor e sem Pix", async () => {
		const n = buildWelcomeNotice({ uid: "u", name: "Ana" });
		expect(n).toMatchObject({ emailOnly: true, url: "/app", scope: { kind: "account" } });
		expect(n).not.toHaveProperty("amountCents");
		const { html, text } = await renderNoticeEmail(n, "https://x.test");
		expect(html).toContain("Abrir o PagueSuaParte");
		expect(html).toContain('href="https://x.test/app"');
		expect(html).toContain("porque criou uma conta no PagueSuaParte");
		expect(html).toContain("Mudar meus avisos");
		for (const item of n.list!) expect(html).toContain(item);
		expect(text).toContain("- Pagar a sua parte por Pix copia e cola.");
		expect(text).toContain("porque criou uma conta");
		expect(buildEmailText(n, "https://x.test")).toBe(text);
	});
	it("nome com HTML é escapado", async () => {
		const { html } = await renderNoticeEmail(buildWelcomeNotice({ uid: "u", name: "<script>x</script>" }), "https://x.test");
		expect(html).not.toContain("<script>x");
	});
});
