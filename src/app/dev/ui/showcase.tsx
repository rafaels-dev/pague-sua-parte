"use client";

import { useState } from "react";
import { AppShellView } from "@/components/app-shell";
import { GoogleButtonView } from "@/components/auth/sign-in-button";
import { CreateGroupFormView } from "@/components/groups/create-group-form";
import { GroupDetailView, GroupDetailSkeleton, type Group } from "@/components/groups/group-detail";
import { GroupsListView, type GroupSummary } from "@/components/groups/groups-list";
import { InviteReady, InviteShell } from "@/components/groups/invite-accept";
import { InviteSheetContent } from "@/components/groups/invite-panel";
import { HomeSummary } from "@/components/home-summary";
import { PixKeyWarningView } from "@/components/pix-key-warning";
import { ProfileFormView } from "@/components/profile-form";
import {
	Avatar,
	Banner,
	Button,
	Card,
	CircularProgress,
	EmptyState,
	Fab,
	ICON_NAMES,
	Icon,
	IconButton,
	List,
	ListItem,
	NavigationBar,
	Sheet,
	Skeleton,
	Snackbar,
	TextField,
	TopAppBar,
} from "@/components/ui";

const noop = () => {};
const USER = { name: "Rafael Schettino", email: "rafael@example.com", picture: null };

const GROUPS: GroupSummary[] = [
	{ id: "1", name: "Família Silva", memberCount: 5, role: "admin" },
	{ id: "2", name: "Viagem a Floripa", memberCount: 4, role: "member" },
	{ id: "3", name: "Despesas da vó", memberCount: 1, role: "admin" },
];

const GROUP: Group = {
	id: "1",
	name: "Família Silva",
	role: "admin",
	members: [
		{ uid: "a", name: "Rafael Schettino", picture: null, role: "admin", hasPixKey: true, isYou: true },
		{ uid: "b", name: "Maria das Dores Silva", picture: null, role: "member", hasPixKey: true, isYou: false },
		{ uid: "c", name: "José", picture: null, role: "member", hasPixKey: false, isYou: false },
		{ uid: "d", name: "Ana Paula", picture: null, role: "admin", hasPixKey: false, isYou: false },
	],
};

const COLOR_ROLES = [
	"primary", "on-primary", "primary-container", "on-primary-container", "secondary-container", "on-secondary-container",
	"tertiary-container", "on-tertiary-container", "surface", "surface-container-low", "surface-container", "surface-container-high",
	"on-surface", "on-surface-variant", "outline", "outline-variant", "error", "error-container", "on-error-container", "receive",
];

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
	return (
		<section className="space-y-4">
			<h2 className="border-b border-outline-variant pb-2 text-headline-small">{title}</h2>
			{children}
		</section>
	);
}

/** Moldura de "aparelho": o transform faz os elementos fixed (barras, FAB) ficarem presos a ela. */
function Frame({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
	return (
		<div className="space-y-2">
			<p className="text-body-large text-on-surface-variant">{label}</p>
			<div className="relative h-[780px] overflow-y-auto overscroll-contain rounded-shape-lg border border-outline-variant bg-surface [transform:translateZ(0)]">
				{children}
			</div>
		</div>
	);
}

function Shell({ pathname, children }: Readonly<{ pathname: string; children: React.ReactNode }>) {
	return (
		<AppShellView pathname={pathname} user={USER} onSignOut={noop} className="min-h-0!">
			{children}
		</AppShellView>
	);
}

export function Showcase({ sheetOpen, snackbarOpen }: Readonly<{ sheetOpen: boolean; snackbarOpen: boolean }>) {
	const [sheet, setSheet] = useState(sheetOpen);
	const [snack, setSnack] = useState(snackbarOpen);
	const [confirming, setConfirming] = useState(false);

	return (
		<main className="mx-auto max-w-6xl space-y-12 px-4 py-8 md:px-8">
			<header className="space-y-2">
				<h1 className="text-headline-large">Racha Pix — kit Material 3</h1>
				<p className="text-body-large text-on-surface-variant">Vitrine de desenvolvimento. Não existe em produção e não usa a API.</p>
			</header>

			<Section title="Cores">
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
					{COLOR_ROLES.map((r) => (
						<div key={r} className="rounded-shape-sm border border-outline-variant p-2">
							<div className="h-10 rounded-shape-sm border border-outline-variant" style={{ background: `var(--md-${r})` }} />
							<p className="mt-1 break-all text-sm">{r}</p>
						</div>
					))}
				</div>
				<div className="grid gap-3 sm:grid-cols-3">
					<div className="rounded-shape-md bg-primary p-4 text-on-primary">primary / on-primary</div>
					<div className="rounded-shape-md bg-primary-container p-4 text-on-primary-container">primary-container</div>
					<div className="rounded-shape-md bg-secondary-container p-4 text-on-secondary-container">secondary-container</div>
					<div className="rounded-shape-md bg-tertiary-container p-4 text-on-tertiary-container">tertiary-container</div>
					<div className="rounded-shape-md bg-error-container p-4 text-on-error-container">error-container</div>
					<div className="rounded-shape-md bg-surface-container-high p-4">
						<span className="money font-bold text-receive">R$ 128,50</span> · <span className="money font-bold text-pay">R$ 45,90</span> ·{" "}
						<span className="text-on-surface-variant">on-surface-variant</span>
					</div>
				</div>
			</Section>

			<Section title="Tipografia">
				<div className="space-y-2">
					<p className="text-display-small">Display small 36</p>
					<p className="text-headline-large">Headline large 32</p>
					<p className="text-headline-medium">Headline medium 28</p>
					<p className="text-headline-small">Headline small 24</p>
					<p className="text-title-large">Title large 22</p>
					<p className="text-title-medium">Title medium 16 / 500</p>
					<p className="text-body-large">Body large 16 — Dividir as contas da família ficou simples. 1.234,56</p>
					<p className="text-label-large">Label large 16 / 500</p>
					<p className="money text-headline-medium font-bold">R$ 1.111,11 / R$ 8.888,88 (tabular)</p>
				</div>
			</Section>

			<Section title="Botões">
				<div className="flex flex-wrap items-center gap-3">
					<Button>Filled</Button>
					<Button variant="tonal">Tonal</Button>
					<Button variant="outlined">Outlined</Button>
					<Button variant="text">Text</Button>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button icon="add">Com ícone</Button>
					<Button variant="tonal" icon="content_copy">
						Copiar link
					</Button>
					<Button variant="outlined" icon="share">
						Compartilhar
					</Button>
					<Button size="md">Altura 48</Button>
					<Button href="/app">Como link</Button>
					<Button href="https://wa.me/" target="_blank" rel="noopener noreferrer" icon="share">
						Link externo
					</Button>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button loading>Salvando...</Button>
					<Button variant="tonal" loading>
						Carregando
					</Button>
					<Button disabled>Desativado</Button>
					<Button variant="outlined" disabled>
						Desativado
					</Button>
					<Button variant="text" disabled>
						Desativado
					</Button>
					<IconButton icon="arrow_back" label="Voltar" />
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<GoogleButtonView />
					<GoogleButtonView busy />
				</div>
			</Section>

			<Section title="Campos de texto">
				<div className="grid max-w-3xl gap-6 md:grid-cols-2">
					<TextField label="Nome" defaultValue="Rafael Schettino" />
					<TextField label="Nome do grupo" placeholder="Despesas da vó" />
					<TextField label="Chave Pix" defaultValue="rafael@exemplo" supportingText="Ainda não parece uma chave Pix válida." />
					<TextField label="Chave Pix" defaultValue="123" error="Chave Pix inválida. Confira o número ou e-mail digitado." />
				</div>
			</Section>

			<Section title="Cartões, listas, avatares">
				<div className="grid gap-4 md:grid-cols-2">
					<Card className="p-5">Card filled (low)</Card>
					<Card variant="outlined" className="p-5">
						Card outlined
					</Card>
					<Card tone="high" className="p-5">
						Card filled (high)
					</Card>
					<div className="flex items-center gap-3">
						<Avatar name="Rafael" size="sm" />
						<Avatar name="Maria" />
						<Avatar name="José" size="lg" />
						<Avatar name="Foto" src="/favicon.svg" />
					</div>
				</div>
				<List>
					<ListItem leading={<Avatar name="Rafael" />} headline="Rafael Schettino (você)" supporting="Administra o grupo" />
					<ListItem
						leading={<Avatar name="Maria" />}
						headline="Maria das Dores"
						supporting="Sem chave Pix"
						trailing={<Icon name="warning" />}
					/>
					<ListItem headline="Item de 56px, só título" href="/dev/ui" trailing={<Icon name="chevron_right" />} />
				</List>
			</Section>

			<Section title="Avisos, estados e progresso">
				<Banner
					title="Você não configurou sua chave Pix."
					action={
						<Button size="md" href="/app/perfil">
							Configurar chave Pix
						</Button>
					}
				>
					Sem ela, as outras pessoas não conseguem pagar você.
				</Banner>
				<Banner tone="error" icon="error" role="alert">
					Sem conexão com a internet. Confira o sinal e tente de novo.
				</Banner>
				<div className="grid gap-4 md:grid-cols-2">
					<EmptyState icon="group" className="rounded-shape-lg bg-surface-container-low" action={<Button icon="add">Criar grupo</Button>}>
						Um grupo reúne as pessoas que dividem as despesas.
					</EmptyState>
					<EmptyState tone="error" icon="error" title="Ops!" action={<Button icon="refresh">Tentar de novo</Button>}>
						Não foi possível carregar seus grupos.
					</EmptyState>
				</div>
				<div className="flex items-center gap-6 text-primary">
					<CircularProgress />
					<div className="w-64 space-y-2 text-on-surface">
						<Skeleton className="h-6" />
						<Skeleton className="h-16 rounded-shape-md" />
					</div>
				</div>
			</Section>

			<Section title="Ícones">
				<div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
					{ICON_NAMES.map((n) => (
						<div key={n} className="flex flex-col items-center gap-1 rounded-shape-sm bg-surface-container-low p-3">
							<Icon name={n} size={32} />
							<span className="text-sm">{n}</span>
						</div>
					))}
				</div>
			</Section>

			<Section title="Navegação, FAB, Sheet e Snackbar">
				<TopAppBar title="Racha Pix" leading={<IconButton icon="arrow_back" label="Voltar" />} trailing={<Avatar name="Rafael" size="sm" />} />
				<div className="flex flex-wrap gap-3">
					<Button onClick={() => setSheet(true)} icon="share">
						Abrir Sheet de convite
					</Button>
					<Button variant="tonal" onClick={() => setSnack(true)}>
						Mostrar Snackbar
					</Button>
				</div>
				<div className="relative h-72 overflow-hidden rounded-shape-lg border border-outline-variant [transform:translateZ(0)]">
					<NavigationBar items={[{ href: "/app", label: "Início", icon: "home" }, { href: "/app/perfil", label: "Meu perfil", icon: "person" }]} activeHref="/app" className="md:flex!" />
					<Fab icon="add" className="bottom-[6.5rem]!">
						Criar grupo
					</Fab>
				</div>
			</Section>

			<Section title="Telas (composições estáticas)">
				<div className="grid gap-8 xl:grid-cols-1">
					<Frame label="Início com grupos">
						<Shell pathname="/app">
							<div className="space-y-6">
								<h1 className="text-headline-medium md:text-headline-large">Olá, Rafael!</h1>
								<PixKeyWarningView />
								<HomeSummary receiveCents={12850} payCents={4590} />
								<GroupsListView state={{ kind: "ready", groups: GROUPS }} />
							</div>
						</Shell>
					</Frame>
					<Frame label="Início vazio">
						<Shell pathname="/app">
							<div className="space-y-6">
								<h1 className="text-headline-medium md:text-headline-large">Olá, Rafael!</h1>
								<HomeSummary receiveCents={0} payCents={0} />
								<GroupsListView state={{ kind: "ready", groups: [] }} />
							</div>
						</Shell>
					</Frame>
					<Frame label="Início carregando">
						<Shell pathname="/app">
							<div className="space-y-6">
								<h1 className="text-headline-medium md:text-headline-large">Olá, Rafael!</h1>
								<HomeSummary receiveCents={0} payCents={0} />
								<GroupsListView state={{ kind: "loading" }} />
							</div>
						</Shell>
					</Frame>
					<Frame label="Início com erro">
						<Shell pathname="/app">
							<div className="space-y-6">
								<h1 className="text-headline-medium md:text-headline-large">Olá, Rafael!</h1>
								<GroupsListView state={{ kind: "error", message: "Não foi possível carregar seus grupos.", onRetry: noop }} />
							</div>
						</Shell>
					</Frame>
					<Frame label="Grupo">
						<Shell pathname="/app/grupos/1">
							<GroupDetailView
								group={GROUP}
								invite={
									<Button icon="share" fullWidth className="md:w-auto">
										Convidar pessoas
									</Button>
								}
							/>
						</Shell>
					</Frame>
					<Frame label="Grupo carregando">
						<Shell pathname="/app/grupos/1">
							<GroupDetailSkeleton />
						</Shell>
					</Frame>
					<Frame label="Criar grupo (com erro)">
						<Shell pathname="/app/grupos/novo">
							<CreateGroupFormView name="" onNameChange={noop} busy={false} error="Escreva um nome para o grupo." onSubmit={noop} />
						</Shell>
					</Frame>
					<Frame label="Perfil com erro na chave Pix">
						<Shell pathname="/app/perfil">
							<ProfileFormView
								email="rafael@example.com"
								picture={null}
								displayName="Rafael Schettino"
								pixKey="123"
								detectedType={null}
								showInvalidHint
								pixError="Chave Pix inválida. Confira o número ou e-mail digitado."
								formError={null}
								saving={false}
								onDisplayName={noop}
								onPixKey={noop}
								onSubmit={noop}
							/>
						</Shell>
					</Frame>
					<Frame label="Convite (logada)">
						<InviteShell>
							<InviteReady groupName="Família Silva" memberCount={5} accepting={false} acceptError={null} onAccept={noop} />
						</InviteShell>
					</Frame>
					<div className="space-y-2">
						<p className="text-body-large text-on-surface-variant">Conteúdo do Sheet de convite (estático)</p>
						<Card className="max-w-md p-6">
							<h2 className="mb-4 text-headline-small">Convite pronto!</h2>
							<InviteSheetContent
								link="https://racha.example/convite/abc"
								groupName="Família Silva"
								isAdmin
								busy={false}
								error={null}
								confirmingNew={confirming}
								copyFailed={false}
								canShare
								onCopy={noop}
								onShare={noop}
								onAskNew={() => setConfirming(true)}
								onCancelNew={() => setConfirming(false)}
								onConfirmNew={noop}
							/>
						</Card>
					</div>
				</div>
			</Section>

			<Sheet open={sheet} onClose={() => setSheet(false)} title="Convite pronto!">
				<InviteSheetContent
					link="https://racha.example/convite/abc"
					groupName="Família Silva"
					isAdmin
					busy={false}
					error={null}
					confirmingNew={false}
					copyFailed={false}
					canShare
					onCopy={() => setSnack(true)}
					onShare={noop}
					onAskNew={noop}
					onCancelNew={noop}
					onConfirmNew={noop}
				/>
				<Snackbar open={snack && sheet} message="Link copiado!" onClose={() => setSnack(false)} />
			</Sheet>
			<Snackbar open={snack && !sheet} message="Salvo!" onClose={() => setSnack(false)} aboveNav />
		</main>
	);
}
