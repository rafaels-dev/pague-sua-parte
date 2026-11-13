import { describe, expect, it, vi } from "vitest";
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

describe("upsertAndWelcome", () => {
	it("agenda as boas-vindas só quando o upsert inseriu, e devolve o usuário", async () => {
		vi.resetModules();
		const after = vi.fn();
		vi.doMock("@/lib/notifications/schedule", () => ({ runAfterResponse: after }));
		const mk = (inserted: boolean) =>
			({ collection: () => ({ findOneAndUpdate: async () => ({ value: { _id: "u1", name: "Ana" }, lastErrorObject: inserted ? { updatedExisting: false, upserted: "u1" } : { updatedExisting: true } }) }) }) as never;
		const { upsertAndWelcome } = await import("./welcome");
		const au = { uid: "u1", email: "a@b.com", emailVerified: true, name: "Ana" };
		expect(await upsertAndWelcome(mk(false), au)).toMatchObject({ _id: "u1" });
		expect(after).not.toHaveBeenCalled();
		await upsertAndWelcome(mk(true), au);
		expect(after).toHaveBeenCalledTimes(1);
		vi.doUnmock("@/lib/notifications/schedule");
	});
});
