import { describe, expect, it } from "vitest";
import { clipboardFileName, filesFromTransfer, pickClipboardType } from "./clipboard-files";

const png = { name: "image.png", type: "image/png", size: 10 } as File;

describe("filesFromTransfer", () => {
	it("usa files quando existem", () => {
		expect(filesFromTransfer({ files: [png], items: [] })).toEqual([png]);
	});
	it("cai para items do tipo arquivo", () => {
		const items = [
			{ kind: "string", type: "text/plain", getAsFile: () => null },
			{ kind: "file", type: "image/png", getAsFile: () => png },
		];
		expect(filesFromTransfer({ files: [], items })).toEqual([png]);
	});
	it("texto puro não é interceptado", () => {
		const items = [{ kind: "string", type: "text/plain", getAsFile: () => null }];
		expect(filesFromTransfer({ files: [], items })).toEqual([]);
	});
	it("tolera nulos", () => {
		expect(filesFromTransfer(null)).toEqual([]);
		expect(filesFromTransfer({})).toEqual([]);
		expect(filesFromTransfer({ items: [{ kind: "file", type: "x", getAsFile: () => null }] })).toEqual([]);
	});
});

describe("pickClipboardType", () => {
	it("prefere os tipos aceitos", () => {
		expect(pickClipboardType(["text/plain", "image/png"])).toBe("image/png");
		expect(pickClipboardType(["text/html", "image/jpeg", "image/png"])).toBe("image/png");
	});
	it("formato não aceito: nada", () => expect(pickClipboardType(["image/bmp"])).toBeNull());
	it("só texto: nada", () => expect(pickClipboardType(["text/plain", "text/html"])).toBeNull());
});

describe("clipboardFileName", () => {
	it("nomes", () => {
		expect(clipboardFileName("image/png", 1)).toBe("print-1.png");
		expect(clipboardFileName("application/pdf", 2)).toBe("print-2.pdf");
		expect(clipboardFileName("image/bmp", 3)).toBe("print-3.png");
	});
});
