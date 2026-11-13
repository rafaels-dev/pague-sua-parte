import { notFound } from "next/navigation";
import { SAMPLE_NOTICES } from "@/lib/notifications/email-samples";
import { renderNoticeEmail } from "@/lib/notifications/email-template";

export const metadata = { title: "E-mails (dev)", robots: { index: false, follow: false } };

/** Pré-visualização dos e-mails de aviso com dados fictícios, em claro e escuro. Não existe em produção e não envia nada. */
export default async function DevEmailsPage() {
	if (process.env.NODE_ENV === "production") notFound();
	const base = "http://localhost:3000";
	const items = await Promise.all(
		SAMPLE_NOTICES.map(async ({ id, notice, receipt }) => {
			const r = await renderNoticeEmail(notice, base, receipt);
			// O iframe segue o tema do navegador; para mostrar o escuro sempre, o bloco do modo escuro passa a valer sempre.
			const darkHtml = r.html.replace("@media (prefers-color-scheme: dark)", "@media all");
			return { id, ...r, darkHtml };
		}),
	);
	return (
		<main style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 1400, margin: "0 auto" }}>
			<h1 style={{ fontSize: 22 }}>E-mails de aviso (dados fictícios)</h1>
			<p style={{ fontSize: 14 }}>Claro e escuro lado a lado, e a versão em texto puro. Nada é enviado.</p>
			{items.map((it) => (
				<section key={it.id} id={it.id} style={{ margin: "32px 0", borderTop: "1px solid #ccc", paddingTop: 16 }}>
					<h2 style={{ fontSize: 16 }}>
						{it.id}
						<small style={{ fontWeight: 400, display: "block" }}>Assunto: {it.subject} ({it.subject.length} caracteres)</small>
					</h2>
					<div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
						<iframe sandbox="" title={`${it.id} claro`} srcDoc={it.html} style={{ width: 640, height: 640, border: "1px solid #ccc", background: "#fff" }} />
						<iframe sandbox="" title={`${it.id} escuro`} srcDoc={it.darkHtml} style={{ width: 640, height: 640, border: "1px solid #ccc", background: "#000" }} />
						<pre style={{ width: 400, whiteSpace: "pre-wrap", fontSize: 13, background: "#f4f4f4", padding: 12 }}>{it.text}</pre>
					</div>
				</section>
			))}
		</main>
	);
}
