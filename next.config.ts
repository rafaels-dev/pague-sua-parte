import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					// Declara o idioma do conteúdo também no cabeçalho HTTP.
					{ key: "Content-Language", value: "pt-BR" },
					// Ninguém pode abrir o app dentro de outro site (clickjacking) nem trocar a base ou o destino dos formulários.
					{ key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					// Os convites levam um código no endereço: outros sites só ficam sabendo de onde a pessoa veio, não o caminho.
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
					{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
				],
			},
		];
	},
};

export default nextConfig;
