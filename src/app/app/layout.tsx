"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { signOut } from "@/lib/auth/client";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const router = useRouter();
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
		<div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
			<header className="flex justify-end px-5 pt-3">
				<button
					type="button"
					onClick={() => void signOut().catch(() => {})}
					className="min-h-11 rounded-xl px-3 text-base text-muted underline active:opacity-70"
				>
					Sair
				</button>
			</header>
			<main className="flex-1 px-5 py-3">{children}</main>
			<nav className="sticky bottom-0 grid grid-cols-2 border-t border-border bg-card text-center text-lg">
				<Link href="/app" className="flex min-h-16 items-center justify-center font-medium">
					Início
				</Link>
				<Link href="/app/perfil" className="flex min-h-16 items-center justify-center font-medium">
					Meu perfil
				</Link>
			</nav>
		</div>
	);
}
