import type { CSSProperties } from "react";
import { Button } from "@react-email/button";
import { Head } from "@react-email/head";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { Preview } from "@react-email/preview";
import { render } from "@react-email/render";
import { appLink, buildEmailText, ctaLabel, highlight, noticeSubject, oneLine, preheader, reasonLine, receiptLineText, SETTINGS_PATH, type ReceiptLine } from "./email-content";
import type { Notice } from "./types";

/**
 * Layout do e-mail (React Email, só no servidor). Tabelas, estilos inline, 600px, pilha de fontes do sistema.
 * Cores vêm dos tokens do app (globals.css). O modo escuro usa classes (`.dm-*`) com `!important` em
 * `prefers-color-scheme` e nos seletores do Outlook.com (`[data-ogsc]`/`[data-ogsb]`).
 * Só o conteúdo (título, texto, link, valor) vem de `messages.ts`/`plan-messages.ts`; aqui só se veste.
 */
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const C = {
	page: "#f5fbf8",
	card: "#ffffff",
	line: "#e3eae7",
	ink: "#171d1b",
	muted: "#3f4946",
	primary: "#006b5e",
	onPrimary: "#ffffff",
	amountBg: "#9ff2e1",
	amountInk: "#00201b",
};
const D = { page: "#0e1513", card: "#1b211f", line: "#3f4946", ink: "#dee4e1", muted: "#bec9c5", primary: "#83d5c5", onPrimary: "#003730", amountBg: "#005046", amountInk: "#9ff2e1" };

const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
	.dm-page { background-color: ${D.page} !important; }
	.dm-card { background-color: ${D.card} !important; border-color: ${D.line} !important; }
	.dm-ink { color: ${D.ink} !important; }
	.dm-muted { color: ${D.muted} !important; }
	.dm-brand { color: ${D.primary} !important; }
	.dm-amount { background-color: ${D.amountBg} !important; }
	.dm-amount-ink { color: ${D.amountInk} !important; }
	.dm-btn { background-color: ${D.primary} !important; color: ${D.onPrimary} !important; border-color: ${D.primary} !important; }
	.dm-rule { border-top-color: ${D.line} !important; }
}
[data-ogsb] .dm-page { background-color: ${D.page} !important; }
[data-ogsb] .dm-card { background-color: ${D.card} !important; }
[data-ogsb] .dm-amount { background-color: ${D.amountBg} !important; }
[data-ogsb] .dm-btn { background-color: ${D.primary} !important; }
[data-ogsc] .dm-ink { color: ${D.ink} !important; }
[data-ogsc] .dm-muted { color: ${D.muted} !important; }
[data-ogsc] .dm-brand { color: ${D.primary} !important; }
[data-ogsc] .dm-amount-ink { color: ${D.amountInk} !important; }
[data-ogsc] .dm-btn { color: ${D.onPrimary} !important; }
@media only screen and (max-width: 480px) { .pad { padding-left: 20px !important; padding-right: 20px !important; } .full { width: 100% !important; } }
`;

const text = (extra: CSSProperties = {}): CSSProperties => ({ margin: 0, fontFamily: FONT, color: C.ink, ...extra });

export function NoticeEmail({ notice, baseUrl, receipt }: Readonly<{ notice: Notice; baseUrl: string; receipt?: ReceiptLine }>) {
	const receiptText = receiptLineText(receipt);
	const link = appLink(baseUrl, notice.url);
	const settings = appLink(baseUrl, SETTINGS_PATH);
	const hi = highlight(notice);
	const cta = ctaLabel(notice.url);
	const logo = appLink(baseUrl, "/icon-192.png");
	return (
		<Html lang="pt-BR" dir="ltr" className="dm-page" style={{ backgroundColor: C.page }}>
			<Head>
				<meta name="color-scheme" content="light dark" />
				<meta name="supported-color-schemes" content="light dark" />
				<title>{noticeSubject(notice)}</title>
				<style>{DARK_CSS}</style>
			</Head>
			<body className="dm-page" style={{ margin: 0, padding: 0, backgroundColor: C.page, width: "100%", WebkitTextSizeAdjust: "100%" }}>
				<Preview>{preheader(notice.body)}</Preview>
					<table role="presentation" className="dm-page" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ backgroundColor: C.page }}>
						<tbody>
							<tr>
								<td align="center" style={{ padding: "24px 12px" }}>
									<table role="presentation" className="full" width={600} cellPadding={0} cellSpacing={0} border={0} style={{ width: "100%", maxWidth: 600 }}>
										<tbody>
											<tr>
												<td style={{ padding: "0 8px 16px" }}>
													<table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
														<tbody>
															<tr>
																<td style={{ verticalAlign: "middle", paddingRight: 12 }}>
																	<Img src={logo} alt="" width={40} height={40} style={{ display: "block", width: 40, height: 40, borderRadius: 10, border: 0 }} />
																</td>
																<td className="dm-brand" style={text({ verticalAlign: "middle", fontSize: 20, fontWeight: 700, color: C.primary })}>
																	PagueSuaParte
																</td>
															</tr>
														</tbody>
													</table>
												</td>
											</tr>
											<tr>
												<td className="dm-card pad" style={{ backgroundColor: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: "32px 32px 28px" }}>
													<table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
														<tbody>
															<tr>
																<td>
																	<h1 className="dm-ink" style={text({ fontSize: 26, lineHeight: "32px", fontWeight: 700 })}>{oneLine(notice.title)}</h1>
																</td>
															</tr>
															<tr>
																<td className="dm-ink" style={text({ fontSize: 18, lineHeight: "28px", paddingTop: 12 })}>
																	{oneLine(notice.body)}
																</td>
															</tr>
															{receiptText ? (
																<tr>
																	<td className="dm-ink" style={text({ fontSize: 18, lineHeight: "28px", fontWeight: 700, paddingTop: 12 })}>
																		{receiptText}
																	</td>
																</tr>
															) : null}
															{notice.list?.length ? (
																<tr>
																	<td style={{ paddingTop: 16 }}>
																		<table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
																			<tbody>
																				{notice.list.map((item, i) => (
																					<tr key={i}>
																						<td className="dm-brand" valign="top" width={28} style={text({ fontSize: 18, lineHeight: "28px", fontWeight: 700, color: C.primary, paddingBottom: 8 })}>
																							&#8226;
																						</td>
																						<td className="dm-ink" valign="top" style={text({ fontSize: 18, lineHeight: "28px", paddingBottom: 8 })}>
																							{oneLine(item)}
																						</td>
																					</tr>
																				))}
																			</tbody>
																		</table>
																	</td>
																</tr>
															) : null}
															{notice.next ? (
																<tr>
																	<td className="dm-ink" style={text({ fontSize: 18, lineHeight: "28px", fontWeight: 700, paddingTop: 8 })}>
																		{oneLine(notice.next)}
																	</td>
																</tr>
															) : null}
															{hi ? (
																<tr>
																	<td style={{ paddingTop: 20 }}>
																		<table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
																			<tbody>
																				<tr>
																					<td className="dm-amount" style={{ backgroundColor: C.amountBg, borderRadius: 14, padding: "16px 20px" }}>
																						<div className="dm-amount-ink" style={text({ fontSize: 16, lineHeight: "22px", color: C.amountInk })}>
																							{hi.label}
																						</div>
																						<div className="dm-amount-ink" style={text({ fontSize: 34, lineHeight: "42px", fontWeight: 700, color: C.amountInk })}>
																							{hi.value}
																						</div>
																					</td>
																				</tr>
																			</tbody>
																		</table>
																	</td>
																</tr>
															) : null}
															<tr>
																<td align="left" style={{ paddingTop: 28 }}>
																	<Button
																		href={link}
																		className="dm-btn"
																		style={{ backgroundColor: C.primary, color: C.onPrimary, fontFamily: FONT, fontSize: 18, fontWeight: 700, lineHeight: "24px", textDecoration: "none", borderRadius: 999, padding: "16px 36px", display: "inline-block", boxSizing: "border-box" }}
																	>
																		{cta}
																	</Button>
																</td>
															</tr>
															<tr>
																<td className="dm-muted" style={text({ fontSize: 16, lineHeight: "24px", color: C.muted, paddingTop: 20, wordBreak: "break-word", overflowWrap: "anywhere" })}>
																	Se o botão não abrir, copie este endereço: {link}
																</td>
															</tr>
														</tbody>
													</table>
												</td>
											</tr>
											<tr>
												<td className="pad" style={{ padding: "20px 8px 0" }}>
													<table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
														<tbody>
															<tr>
																<td className="dm-muted" style={text({ fontSize: 14, lineHeight: "21px", color: C.muted })}>
																	{reasonLine(notice.scope)}
																</td>
															</tr>
															<tr>
																<td className="dm-muted" style={text({ fontSize: 14, lineHeight: "21px", color: C.muted, paddingTop: 8 })}>
																	<a href={settings} className="dm-brand" style={{ color: C.primary, fontWeight: 700, textDecoration: "underline" }}>
																		Mudar meus avisos
																	</a>
																</td>
															</tr>
														</tbody>
													</table>
												</td>
											</tr>
										</tbody>
									</table>
								</td>
							</tr>
						</tbody>
					</table>
			</body>
		</Html>
	);
}

/** HTML + texto puro + assunto de um aviso. */
export async function renderNoticeEmail(notice: Notice, baseUrl: string, receipt?: ReceiptLine): Promise<{ subject: string; html: string; text: string }> {
	const html = await render(<NoticeEmail notice={notice} baseUrl={baseUrl} receipt={receipt} />);
	return { subject: noticeSubject(notice), html, text: buildEmailText(notice, baseUrl, receipt) };
}
