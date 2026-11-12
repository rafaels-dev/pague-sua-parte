import { describe, expect, it } from "vitest";
import { payerPixNotice } from "./payer-pix-notice";

describe("payerPixNotice", () => {
	it("você mesmo: bloqueia só se você não tem chave", () => {
		expect(payerPixNotice({ isYou: true }, true)).toBe("block");
		expect(payerPixNotice({ isYou: true }, false)).toBe("ok");
	});
	it("quem você cuida sem chave: bloqueia; com chave: ok", () => {
		expect(payerPixNotice({ isYou: false, kind: "managed", youManage: true, hasPixKey: false }, false)).toBe("block");
		expect(payerPixNotice({ isYou: false, kind: "managed", youManage: true, hasPixKey: true }, false)).toBe("ok");
	});
	it("administrador por outro membro sem chave avisa, tanto de login quanto sem celular de outro responsável", () => {
		expect(payerPixNotice({ isYou: false, kind: "user", hasPixKey: false }, false)).toBe("warn");
		expect(payerPixNotice({ isYou: false, kind: "managed", youManage: false, hasPixKey: false }, false)).toBe("warn");
		expect(payerPixNotice({ isYou: false, kind: "user", hasPixKey: true }, false)).toBe("ok");
		// mesmo sem chave minha, escolher outro pagador não bloqueia
		expect(payerPixNotice({ isYou: false, kind: "user", hasPixKey: false }, true)).toBe("warn");
	});
});
