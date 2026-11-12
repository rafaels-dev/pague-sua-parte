import type { MetadataRoute } from "next";

// Necessário para receber avisos no iPhone (o app precisa estar na Tela de Início).
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "PagueSuaParte",
		short_name: "PagueSuaParte",
		description: "Divida as despesas da família e pague por Pix.",
		lang: "pt-BR",
		start_url: "/app",
		scope: "/",
		display: "standalone",
		background_color: "#f5fbf8",
		theme_color: "#f5fbf8",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	};
}
