import Link from "next/link";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	// TODO(auth agent): proteger as rotas /app/* (redirecionar para / se deslogado).
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
			<main className="flex-1 px-5 py-6">{children}</main>
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
