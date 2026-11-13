"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { InboxBell } from "@/components/inbox/inbox-bell";
import { Avatar, Icon, IconButton, NavigationBar, NavigationRail, SegmentedButton, TopAppBar, type NavItem } from "@/components/ui";
import { screenInfo } from "@/lib/ui/titles";
import { cx } from "@/lib/ui/cx";
import { applyTheme, readTheme, type Theme } from "@/lib/ui/theme";

export const NAV_ITEMS: NavItem[] = [
	{ href: "/app", label: "Início", icon: "home" },
	{ href: "/app/perfil", label: "Meu perfil", icon: "person" },
];

const THEMES = [
	{ value: "auto", label: "Auto" },
	{ value: "light", label: "Claro" },
	{ value: "dark", label: "Escuro" },
] as const;

/** "Tema": automático (segue o aparelho), claro ou escuro. */
function ThemeChoice() {
	const [theme, setTheme] = useState<Theme>(() => (typeof document === "undefined" ? "auto" : readTheme()));
	return (
		<div className="space-y-2 border-t border-outline-variant px-4 py-3">
			<p className="text-title-medium text-on-surface-variant">Tema</p>
			<SegmentedButton
				label="Tema"
				value={theme}
				options={THEMES}
				onChange={(t) => {
					setTheme(t);
					applyTheme(t);
				}}
			/>
		</div>
	);
}

export type ShellUser = { name: string; email: string; picture: string | null };

function AccountMenu({ user, onSignOut }: Readonly<{ user: ShellUser; onSignOut: () => void }>) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent | TouchEvent) => {
			if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setOpen(false);
				trigger.current?.focus();
			}
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("touchstart", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("touchstart", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div ref={root} className="relative">
			<button
				ref={trigger}
				type="button"
				aria-label="Minha conta"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="state-layer flex size-12 items-center justify-center rounded-full"
			>
				<Avatar name={user.name} src={user.picture} size="sm" />
			</button>
			{open && (
				<div
					role="menu"
					className="absolute right-0 top-14 z-40 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-shape-md border border-outline-variant bg-surface-container-high py-2 [animation:fade-in_150ms_ease-out]"
				>
					<div className="px-4 pb-3 pt-2">
						<p className="truncate text-title-medium">{user.name}</p>
						<p className="truncate text-body-large text-on-surface-variant">{user.email}</p>
					</div>
					<ThemeChoice />
					<div className="border-t border-outline-variant py-1">
						<Link
							role="menuitem"
							href="/app/perfil"
							onClick={() => setOpen(false)}
							className="state-layer flex min-h-14 items-center gap-4 px-4 text-body-large"
						>
							<Icon name="person" className="text-on-surface-variant" />
							Meu perfil
						</Link>
						<button
							role="menuitem"
							type="button"
							onClick={() => {
								setOpen(false);
								onSignOut();
							}}
							className="state-layer flex min-h-14 w-full items-center gap-4 px-4 text-left text-body-large"
						>
							<Icon name="logout" className="text-on-surface-variant" />
							Sair
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** Casca do app: barra superior, barra inferior (celular) ou trilho lateral (md+) e conteúdo com largura máxima. */
export function AppShellView({
	pathname,
	search = "",
	user,
	unseen = 0,
	onSignOut,
	children,
	className,
}: Readonly<{ pathname: string; search?: string; user: ShellUser; unseen?: number; onSignOut: () => void; children: React.ReactNode; className?: string }>) {
	const info = screenInfo(pathname, search);
	const inner = "mx-auto w-full max-w-5xl md:px-7";
	return (
		<div className={cx("min-h-dvh md:pl-20", className)}>
			<NavigationRail
				items={NAV_ITEMS}
				activeHref={info.nav}
				header={
					<Link href="/app" aria-label="PagueSuaParte, início">
						<BrandMark size={48} />
					</Link>
				}
			/>
			<TopAppBar
				title={info.title}
				innerClassName="mx-auto w-full max-w-5xl md:px-4"
				leading={info.back ? <IconButton icon="arrow_back" label="Voltar" href={info.back} /> : undefined}
				trailing={
					<>
						<InboxBell unseen={unseen} />
						<AccountMenu user={user} onSignOut={onSignOut} />
					</>
				}
			/>
			<main className={cx(inner, "px-4 pb-44 pt-2 md:pb-12")}>{children}</main>
			<NavigationBar items={NAV_ITEMS} activeHref={info.nav} />
		</div>
	);
}
