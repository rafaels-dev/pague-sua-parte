import type { Metadata } from "next";
import { Home } from "@/components/landing/home";

export const metadata: Metadata = {
	title: { absolute: "PagueSuaParte: divida os gastos da família e pague por Pix" },
	description:
		"App grátis e de código aberto para dividir as despesas da família: lance o gasto, veja quanto cada um deve, pague por Pix e anexe o comprovante.",
	openGraph: {
		title: "PagueSuaParte: cada um paga a sua parte",
		description: "Divida os gastos da família e pague tudo por Pix, com comprovante.",
		locale: "pt_BR",
		siteName: "PagueSuaParte",
		type: "website",
	},
};

export default function Page() {
	return <Home />;
}
