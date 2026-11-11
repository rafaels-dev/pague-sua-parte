import { notFound } from "next/navigation";
import { Showcase } from "./showcase";

export const metadata = { title: "UI (dev)", robots: { index: false, follow: false } };

/** Vitrine de desenvolvimento do kit Material 3. Não existe em produção e não chama a API. */
export default async function DevUiPage({
	searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
	if (process.env.NODE_ENV === "production") notFound();
	const sp = await searchParams;
	return <Showcase sheetOpen={sp.sheet === "open"} snackbarOpen={sp.snackbar === "open"} />;
}
