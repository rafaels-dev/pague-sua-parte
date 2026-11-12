import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import { THEME_INIT_SCRIPT } from "@/lib/ui/theme";
import "./globals.css";

const roboto = Roboto({
	subsets: ["latin"],
	weight: ["400", "500", "700"],
	display: "swap",
	variable: "--font-roboto",
});

export const metadata: Metadata = {
	title: { default: "PagueSuaParte", template: "%s | PagueSuaParte" },
	description: "Divida as despesas da família de forma simples: lance o gasto, pague por Pix e anexe o comprovante.",
	icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
	appleWebApp: { capable: true, title: "PagueSuaParte", statusBarStyle: "default" },
	openGraph: { locale: "pt_BR", siteName: "PagueSuaParte", type: "website" },
	// O conteúdo já está em português: evita que o navegador ofereça tradução.
	other: { google: "notranslate" },
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#f5fbf8" },
		{ media: "(prefers-color-scheme: dark)", color: "#0e1513" },
	],
	colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="pt-BR" translate="no" className={roboto.variable} suppressHydrationWarning>
			<head>
				{/* Aplica o tema escolhido antes da primeira pintura. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
			</head>
			<body className="min-h-dvh antialiased"><AuthProvider>{children}</AuthProvider></body>
		</html>
	);
}
