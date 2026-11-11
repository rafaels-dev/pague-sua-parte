import { describe, expect, it } from "vitest";
import { buildInviteLink, buildShareText, buildWhatsAppUrl, initialOf, peopleLabel } from "./invite";

describe("invite helpers", () => {
	it("builds the invite link", () => {
		expect(buildInviteLink("https://racha.app", "abc123")).toBe("https://racha.app/convite/abc123");
		expect(buildInviteLink("http://localhost:3000/", "t")).toBe("http://localhost:3000/convite/t");
	});

	it("builds the share text with name and link", () => {
		expect(buildShareText("Família", "https://x/convite/1")).toBe(
			'Entre no grupo "Família" no Racha Pix para dividirmos as despesas: https://x/convite/1',
		);
	});

	it("encodes the WhatsApp url", () => {
		const url = buildWhatsAppUrl('Oi "vó" & cia: https://x/y?z=1');
		expect(url.startsWith("https://wa.me/?text=")).toBe(true);
		expect(decodeURIComponent(url.split("text=")[1])).toBe('Oi "vó" & cia: https://x/y?z=1');
		expect(url).not.toContain(" ");
	});

	it("pluralizes people", () => {
		expect(peopleLabel(1)).toBe("1 pessoa");
		expect(peopleLabel(3)).toBe("3 pessoas");
	});

	it("gets the initial", () => {
		expect(initialOf("  ana")).toBe("A");
		expect(initialOf("émerson")).toBe("É");
		expect(initialOf("")).toBe("?");
	});
});
