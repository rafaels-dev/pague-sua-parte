import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import "./globals.css";

const roboto = Roboto({
	subsets: ["latin"],
	weight: ["400", "500", "700"],
	display: "swap",
	variable: "--font-roboto",
});

export const metadata: Metadata = {
	title: { default: "Racha Pix", template: "%s | Racha Pix" },
	description: "Divida as despesas da família de forma simples: lance o gasto, pague por Pix e anexe o comprovante.",
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
		<html lang="pt-BR" className={roboto.variable}>
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
			</head>
			<body className="min-h-dvh antialiased"><AuthProvider>{children}</AuthProvider></body>
		</html>
	);
}
