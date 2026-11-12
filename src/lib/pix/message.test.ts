import { describe, expect, it } from "vitest";
import { batchMessage, refundMessage, shareMessage } from "./message";

describe("mensagens do Pix", () => {
	it("parte de despesa", () => {
		expect(shareMessage("Mercado do mes")).toBe("Despesa Mercado do mes");
		expect(shareMessage("TV", { number: 2, count: 6 })).toBe("Despesa TV parcela 2 de 6");
	});
	it("parcela: com chave UUID (orçamento 37) corta o título e mantém a parcela", () => {
		const m = shareMessage("Televisao da sala nova", { number: 2, count: 6 }, 37);
		expect(m).toBe("Despesa Televisao da parcela 2 de 6");
		expect(m.length).toBeLessThanOrEqual(37);
		expect(shareMessage("TV", { number: 2, count: 6 }, 37)).toBe("Despesa TV parcela 2 de 6");
	});
	it("parcela: sem espaço nem para ~6 letras de título, larga a parcela", () => {
		expect(shareMessage("Televisao", { number: 2, count: 6 }, 20)).toBe("Despesa Televisao");
	});
	it("devolução", () => {
		expect(refundMessage("Mercado do mes")).toBe("Devolucao Mercado do mes");
		expect(refundMessage("TV", { number: 1, count: 3 })).toBe("Devolucao TV parcela 1 de 3");
	});
	it("pagar tudo", () => {
		expect(batchMessage([{ description: "Luz", kind: "share", installment: null }])).toBe("Despesa Luz");
		expect(batchMessage([{ description: "Luz", kind: "refund" }])).toBe("Devolucao Luz");
		expect(batchMessage([{ description: "Luz" }, { description: "Agua" }, { description: "Gas" }])).toBe("PagueSuaParte 3 contas");
	});
});
