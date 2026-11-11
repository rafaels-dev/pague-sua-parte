import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Declara o idioma do conteúdo também no cabeçalho HTTP.
	async headers() {
		return [{ source: "/:path*", headers: [{ key: "Content-Language", value: "pt-BR" }] }];
	},
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
