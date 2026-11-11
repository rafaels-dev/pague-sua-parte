"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { signOut } from "@/lib/auth/client";

const NAV = [
	{ href: "/app", label: "Início" },
	{ href: "/app/perfil", label: "Meu perfil" },
];

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const router = useRouter();
	const pathname = usePathname();
	const { user, loading } = useAuth();

	useEffect(() => {
		if (!loading && !user) router.replace("/");
	}, [loading, user, router]);

	if (loading || !user) {
		return (
			<div className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center px-5">
				<p className="text-xl text-muted" role="status">
					Carregando...
				</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-dvh flex-col">
			<header className="border-border md:border-b md:bg-card">
				<div className="mx-auto flex w-full max-w-md items-center gap-6 px-5 pt-3 md:max-w-4xl md:px-8 md:py-3">
					<Link href="/app" className="text-xl font-bold tracking-tight">
						Racha Pix
					</Link>

					{/* Em telas largas a navegação fica no topo; no celular, na barra inferior. */}
					<nav className="hidden gap-2 md:flex" aria-label="Principal">
						{NAV.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								aria-current={pathname === item.href ? "page" : undefined}
								className="flex min-h-11 items-center rounded-xl px-4 text-lg font-medium text-muted hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground"
							>
								{item.label}
							</Link>
						))}
					</nav>

					<button
						type="button"
						onClick={() => void signOut().catch(() => {})}
						className="ml-auto min-h-11 rounded-xl px-3 text-base text-muted underline active:opacity-70"
					>
						Sair
					</button>
				</div>
			</header>

			<main className="mx-auto w-full max-w-md flex-1 px-5 py-3 md:max-w-4xl md:px-8 md:py-8">{children}</main>

			<nav
				className="sticky bottom-0 grid grid-cols-2 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-center text-lg md:hidden"
				aria-label="Principal"
			>
				{NAV.map((item) => (
					<Link
						key={item.href}
						href={item.href}
						aria-current={pathname === item.href ? "page" : undefined}
						className="flex min-h-16 items-center justify-center font-medium text-muted aria-[current=page]:text-foreground"
					>
						{item.label}
					</Link>
				))}
			</nav>
		</div>
	);
}
