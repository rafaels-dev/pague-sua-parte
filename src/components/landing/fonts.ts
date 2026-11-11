import { Fredoka } from "next/font/google";

/** Única fonte de destaque do app, usada só nos títulos e botões da página inicial (o resto continua em Roboto). */
export const fredoka = Fredoka({
	subsets: ["latin"],
	weight: ["500", "600"],
	display: "swap",
	variable: "--font-fredoka",
});
