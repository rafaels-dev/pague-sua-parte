import { BrandMark } from "@/components/brand";
import { fredoka } from "@/components/landing/fonts";
import { CareMock, HelpMock, NoticeMock, PayAllMock, PixScreenMock, PlanMock, ShareMock } from "@/components/landing/mocks";
import { Icon } from "@/components/ui";

const REPO_URL = "https://github.com/rafaels-dev/pague-sua-parte";

const STEPS = [
	{ title: "Crie o grupo", text: "Entre com sua conta Google e chame a família por um link." },
	{ title: "Lance o gasto", text: "Tire foto da conta, anexe um PDF ou cole um print." },
	{ title: "Veja sua parte", text: "A conta sai pronta: todos, só alguns ou só você." },
	{ title: "Pague por Pix", text: "Use o Pix Copia e Cola ou o QR Code e anexe o comprovante." },
] as const;

const SLIPS = [
	{ text: "Quem pagou o exame da vovó?", tone: "bg-lp-card text-lp-ink", place: "-rotate-2 md:mr-16" },
	{ text: "Me passa o Pix?", tone: "bg-lp-accent text-lp-on-field", place: "rotate-1 md:ml-16" },
	{ text: "Já paguei! Cadê o comprovante?", tone: "bg-lp-coral text-lp-on-field", place: "-rotate-1 md:mr-6" },
] as const;

const CONTAINER = "mx-auto w-full max-w-[1200px] px-5 md:px-10";
const H2 = "text-balance font-display text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.02em] [overflow-wrap:break-word] min-w-0 md:text-[3.25rem]";
const H3 = "font-display text-[1.5rem] font-semibold leading-[1.15] tracking-[-0.01em]";
const TILE = "lp-sheet rounded-shape-lg p-6 md:p-8";

/** Tela inicial: marca, frase de valor e (no slot) o botão de entrar, na página inteira. */
export function LandingView({ children, footer }: Readonly<{ children: React.ReactNode; footer: React.ReactNode }>) {
	return (
		<div className={`lp-root ${fredoka.variable} min-h-dvh`}>
			<header className={`${CONTAINER} flex h-20 items-center justify-between`}>
				<span className="flex items-center gap-3">
					<BrandMark size={44} />
					<span className="font-display text-[1.375rem] font-semibold tracking-[-0.01em]">PagueSuaParte</span>
				</span>
				<a href={REPO_URL} className="lp-link" rel="noopener">
					GitHub
				</a>
			</header>

			<main>
				{/* Primeira tela: a promessa, o botão de entrar e a tela do Pix do próprio app. */}
				<section className="pb-16 pt-6 md:pb-24 md:pt-10">
					<div className={`${CONTAINER} grid items-center gap-12 md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:gap-16`}>
						<div className="space-y-6">
							<h1 className="font-display text-[2.75rem] font-semibold leading-[1.04] tracking-[-0.03em] [overflow-wrap:break-word] min-w-0 md:text-[4.5rem]">
								Cada um paga a sua parte.
							</h1>
							<p className="max-w-[30ch] text-[1.25rem] leading-[1.5] text-lp-ink-2 md:text-[1.375rem]">
								Divida os gastos da família e pague tudo por Pix.
							</p>
							<div className="max-w-sm space-y-4 pt-2">
								<div className="lp-cta">{children}</div>
								<p className="text-body-large text-lp-muted">{footer}</p>
							</div>
						</div>

						<figure className="relative mx-auto w-full max-w-[26rem] md:mx-0 md:justify-self-end">
							<div aria-hidden="true" className="lp-sheet absolute inset-0 rotate-3 rounded-shape-lg bg-lp-sugar" />
							<div className="lp-sheet lp-grain relative overflow-hidden rounded-shape-lg ring-2 ring-lp-ink/10">
								<PixScreenMock />
							</div>
							<div
								aria-hidden="true"
								className="lp-sheet absolute -right-2 -top-8 flex size-28 -rotate-6 items-center justify-center rounded-full bg-lp-coral p-3 text-center font-display text-[1.0625rem] font-semibold leading-[1.1] text-lp-on-field md:-right-8"
							>
								Grátis e código aberto
							</div>
							<figcaption className="sr-only">Tela do app mostrando a sua parte da despesa e o botão para copiar o Pix.</figcaption>
						</figure>
					</div>
				</section>

				{/* Origem: o grupo de WhatsApp da família. */}
				<section className="lp-grain rounded-t-[2.5rem] bg-lp-paper-2 py-20 md:rounded-t-[4rem] md:py-32">
					<div className={`${CONTAINER} grid items-center gap-12 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-16`}>
						<div className="space-y-6">
							<h2 className={H2}>Nasceu no grupo de WhatsApp da família.</h2>
							<p className="max-w-[44ch] text-[1.25rem] leading-[1.6] text-lp-ink-2">
								Eram os exames e remédios da vovó, e ninguém sabia quem pagou o quê. Agora a conta fica{" "}
								<mark className="rounded-sm bg-lp-accent px-1 text-lp-on-field [box-decoration-break:clone]">num lugar só</mark>, para qualquer
								família ou grupo.
							</p>
						</div>
						<div aria-hidden="true" className="flex flex-col gap-5">
							{SLIPS.map((s) => (
								<p key={s.text} className={`lp-sheet rounded-shape-md px-5 py-4 font-display text-[1.25rem] font-medium leading-[1.25] ${s.tone} ${s.place}`}>
									{s.text}
								</p>
							))}
						</div>
					</div>
				</section>

				{/* Como funciona. */}
				<section className="py-20 md:py-32">
					<div className={`${CONTAINER} space-y-12 md:space-y-16`}>
						<h2 className={`${H2} max-w-[24ch]`}>Quatro passos até o Pix.</h2>
						<ol role="list" className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
							{STEPS.map((step, i) => (
								<li key={step.title} className="space-y-4 border-t-2 border-lp-rule pt-6">
									<span
										aria-hidden="true"
										className="lp-sheet flex size-16 items-center justify-center rounded-full bg-lp-accent font-display text-[2rem] font-semibold text-lp-on-field"
									>
										{i + 1}
									</span>
									<h3 className={H3}>{step.title}</h3>
									<p className="text-[1.125rem] leading-[1.55] text-lp-ink-2">{step.text}</p>
								</li>
							))}
						</ol>
					</div>
				</section>

				{/* Antes do grupo: planejar a despesa e perguntar quem vai. */}
				<section className="lp-grain rounded-t-[2.5rem] bg-lp-paper-2 py-20 md:rounded-t-[4rem] md:py-32">
					<div className={`${CONTAINER} grid items-center gap-12 md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:gap-16`}>
						<div className="space-y-6">
							<h2 className={H2}>Vai dividir uma viagem? Pergunte antes quem vai.</h2>
							<p className="max-w-[40ch] text-[1.25rem] leading-[1.6] text-lp-ink-2">
								Crie um plano e mande o link. Cada um responde Vou ou Não vou e diz até quanto pode pagar. O app mostra quando a conta fecha e
								por quanto.
							</p>
						</div>
						<div className="lp-sheet rounded-shape-lg ring-2 ring-lp-ink/10 md:justify-self-end">
							<PlanMock />
						</div>
					</div>
				</section>

				{/* O que mais cabe. */}
				<section className="py-20 md:py-32">
					<div className={`${CONTAINER} space-y-12 md:space-y-16`}>
						<h2 className={`${H2} max-w-[24ch]`}>Feito para a família toda.</h2>
						<div className="grid gap-5 md:grid-cols-12">
							<article className={`${TILE} space-y-6 bg-lp-card md:col-span-7`}>
								<div className="space-y-2">
									<h3 className={H3}>Pague tudo com um Pix</h3>
									<p className="max-w-[40ch] text-[1.125rem] leading-[1.55] text-lp-ink-2">
										O que você deve à mesma pessoa vira um só Pix e um só comprovante.
									</p>
								</div>
								<PayAllMock />
							</article>
							<article className={`${TILE} space-y-6 bg-lp-sugar md:col-span-5`}>
								<div className="space-y-2">
									<h3 className={H3}>Vô sem celular? Sem problema.</h3>
									<p className="text-[1.125rem] leading-[1.55] text-lp-ink-2">Um parente cuida da conta dele no app.</p>
								</div>
								<CareMock />
							</article>
							<article className={`${TILE} space-y-6 bg-lp-card md:col-span-5`}>
								<div className="space-y-2">
									<h3 className={H3}>Quem pode, ajuda mais</h3>
									<p className="text-[1.125rem] leading-[1.55] text-lp-ink-2">
										Quando um parente paga sozinho, os outros tocam em Quero ajudar e entram na divisão.
									</p>
								</div>
								<HelpMock />
							</article>
							<article className={`${TILE} space-y-6 bg-lp-accent text-lp-on-field md:col-span-7`}>
								<div className="space-y-2">
									<h3 className={H3}>Avisos no celular</h3>
									<p className="max-w-[40ch] text-[1.125rem] leading-[1.55]">
										Saiba quando alguém entrar no grupo, pagar ou lançar uma despesa. Ficam guardados no sininho do app; no celular, você liga em Perfil.
									</p>
								</div>
								<NoticeMock />
							</article>
							<article className={`${TILE} flex flex-col justify-between gap-6 bg-lp-mint text-lp-on-field md:col-span-12`}>
								<div className="space-y-2">
									<h3 className={H3}>Avise no WhatsApp</h3>
									<p className="text-[1.125rem] leading-[1.55]">Um toque leva a despesa para o grupo.</p>
								</div>
								<ShareMock />
							</article>
						</div>
						<ul role="list" className="grid gap-x-10 gap-y-6 text-[1.125rem] leading-[1.55] text-lp-ink-2 md:grid-cols-2">
							<li className="border-t-2 border-lp-rule pt-4">
								<strong className="block font-display text-[1.25rem] font-semibold text-lp-ink">Despesas fixas</strong>
								Entram sozinhas todo mês.
							</li>
							<li className="border-t-2 border-lp-rule pt-4">
								<strong className="block font-display text-[1.25rem] font-semibold text-lp-ink">Devolução</strong>
								Pagou a mais? A diferença fica como devolução, sem conta-corrente.
							</li>
							<li className="border-t-2 border-lp-rule pt-4">
								<strong className="block font-display text-[1.25rem] font-semibold text-lp-ink">Parcelado no cartão</strong>
								Cada parcela tem a sua data de vencimento.
							</li>
							<li className="border-t-2 border-lp-rule pt-4">
								<strong className="block font-display text-[1.25rem] font-semibold text-lp-ink">Quem pagou mais, quem pagou menos</strong>
								Um relatório mostra como ficou a divisão.
							</li>
							<li className="border-t-2 border-lp-rule pt-4 md:col-span-2">
								<strong className="block font-display text-[1.25rem] font-semibold text-lp-ink">Pague aos poucos</strong>
								Só tem uma parte do dinheiro agora? Pague o que der e o app mostra quanto falta. Em compra parcelada, dá para adiantar parcelas.
							</li>
						</ul>
					</div>
				</section>

				{/* Código aberto. */}
				<section className="lp-grain rounded-t-[2.5rem] bg-lp-ink py-20 text-lp-paper md:rounded-t-[4rem] md:py-28">
					<div className={`${CONTAINER} grid items-center gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-16`}>
						<div className="space-y-5">
							<h2 className={H2}>Grátis, aberto e feito em família.</h2>
							<p className="max-w-[44ch] text-[1.25rem] leading-[1.6] opacity-90">
								Qualquer pessoa pode ver o código e ajudar a melhorar o app. Ele tem tema claro e escuro e abre direto no navegador do celular.
							</p>
						</div>
						<div className="md:justify-self-end">
							<a href={REPO_URL} className="lp-link lp-link--on-ink" rel="noopener">
								Ver o código no GitHub
							</a>
						</div>
					</div>
				</section>

				{/* Fecha na ação: entrar. */}
				<section className="bg-lp-paper-2 py-20 md:py-28">
					<div className={`${CONTAINER} flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between`}>
						<h2 className={`${H2} max-w-[16ch]`}>Chame a família e divida a conta.</h2>
						<div className="lp-cta w-full max-w-sm">{children}</div>
					</div>
				</section>
			</main>

			<footer className="bg-lp-paper-2">
				<div className={`${CONTAINER} flex flex-col gap-4 border-t-2 border-lp-rule py-8 md:flex-row md:items-center md:justify-between`}>
					<span className="flex items-center gap-3">
						<Icon name="favorite" size={20} className="text-lp-coral" />
						<span className="text-body-large text-lp-muted">Feito por uma família, para todas as famílias.</span>
					</span>
					<a href={REPO_URL} className="lp-link w-fit" rel="noopener">
						Código no GitHub
					</a>
				</div>
			</footer>
		</div>
	);
}
