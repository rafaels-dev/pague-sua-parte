import { notFound } from "next/navigation";
import { Telas } from "./telas";

export const metadata = { title: "Telas (dev)", robots: { index: false, follow: false } };

/** Telas de despesas com dados de mentira, em tela cheia (para conferir no celular e no desktop). Só em desenvolvimento. */
export default async function DevTelasPage({
	searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
	if (process.env.NODE_ENV === "production") notFound();
	const sp = await searchParams;
	return <Telas tela={typeof sp.tela === "string" ? sp.tela : "grupo"} />;
}
