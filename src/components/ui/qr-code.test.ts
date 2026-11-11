import { describe, expect, it } from "vitest";
import { matrixToPath, qrMatrix } from "./qr-code";

/** Reconstrói a matriz a partir do path para conferir que nada se perde. */
function rasterize(path: string, n: number, offset: number): boolean[][] {
	const grid = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
	for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
		const [x, y, w] = [Number(m[1]) - offset, Number(m[2]) - offset, Number(m[3])];
		for (let i = 0; i < w; i++) grid[y][x + i] = true;
	}
	return grid;
}

describe("matrixToPath", () => {
	it("junta módulos adjacentes em faixas", () => {
		expect(matrixToPath([[true, true, false], [false, true, false]])).toBe("M0 0h2v1h-2zM1 1h1v1h-1z");
		expect(matrixToPath([[false]])).toBe("");
		expect(matrixToPath([[true]], 4)).toBe("M4 4h1v1h-1z");
	});
	it("é fiel à matriz de um payload real", () => {
		const m = qrMatrix("00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D");
		expect(m.length).toBeGreaterThanOrEqual(21);
		expect(m.every((r) => r.length === m.length)).toBe(true);
		expect(rasterize(matrixToPath(m, 4), m.length, 4)).toEqual(m);
		// finder pattern no canto superior esquerdo
		expect(m[0].slice(0, 7)).toEqual(Array(7).fill(true));
	});
});
