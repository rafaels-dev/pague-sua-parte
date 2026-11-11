import qrcode from "qrcode-generator";

const QUIET_ZONE = 4;

/** Matriz de módulos (true = escuro) com correção de erro M e versão automática. */
export function qrMatrix(value: string): boolean[][] {
	const qr = qrcode(0, "M");
	qr.addData(value);
	qr.make();
	const n = qr.getModuleCount();
	return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** Converte a matriz em um único `path` (uma faixa horizontal por sequência de módulos escuros). */
export function matrixToPath(matrix: boolean[][], offset = 0): string {
	const parts: string[] = [];
	matrix.forEach((row, y) => {
		let x = 0;
		while (x < row.length) {
			if (!row[x]) {
				x++;
				continue;
			}
			const start = x;
			while (x < row.length && row[x]) x++;
			parts.push(`M${start + offset} ${y + offset}h${x - start}v1h${start - x}z`);
		}
	});
	return parts.join("");
}

/**
 * QR Code em SVG inline. Sempre preto sobre branco, com margem de 4 módulos,
 * independentemente do tema, para que apps de banco consigam ler no modo escuro.
 */
export function QrCode({
	value,
	size = 224,
	className,
	label = "QR Code",
}: Readonly<{ value: string; size?: number; className?: string; label?: string }>) {
	const matrix = qrMatrix(value);
	const total = matrix.length + QUIET_ZONE * 2;
	return (
		<svg
			role="img"
			aria-label={label}
			xmlns="http://www.w3.org/2000/svg"
			viewBox={`0 0 ${total} ${total}`}
			width={size}
			height={size}
			shapeRendering="crispEdges"
			className={className}
		>
			<rect width={total} height={total} fill="#ffffff" />
			<path d={matrixToPath(matrix, QUIET_ZONE)} fill="#000000" />
		</svg>
	);
}
