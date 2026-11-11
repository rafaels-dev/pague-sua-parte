"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { SignInButton } from "@/components/auth/sign-in-button";

export default function Home() {
	const router = useRouter();
	const { user, loading } = useAuth();

	useEffect(() => {
		if (user) router.replace("/app");
	}, [user, router]);

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
			<div className="space-y-3">
				<h1 className="text-4xl font-bold tracking-tight">Racha Pix</h1>
				<p className="text-xl text-muted">
					Registre os gastos da família, veja quanto cada um deve e pague por Pix com comprovante.
				</p>
			</div>

			{loading || user ? (
				<p className="text-center text-xl text-muted" role="status">
					Carregando...
				</p>
			) : (
				<SignInButton onSignedIn={() => router.replace("/app")} />
			)}

			<p className="text-center text-base text-muted">Usamos sua conta Google apenas para identificar você.</p>
		</main>
	);
}
