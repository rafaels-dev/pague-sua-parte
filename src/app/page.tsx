"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { SignInButton } from "@/components/auth/sign-in-button";
import { LandingView } from "@/components/landing-view";
import { CircularProgress } from "@/components/ui";
import { safeReturnPath } from "@/lib/ui/return-to";

export default function Home() {
	const router = useRouter();
	const { user, loading } = useAuth();

	// Depois do login, volta para o endereço que a pessoa tentou abrir (só caminhos do próprio app).
	const goNext = useCallback(() => {
		const back = safeReturnPath(new URLSearchParams(window.location.search).get("voltar"));
		router.replace(back ?? "/app");
	}, [router]);

	useEffect(() => {
		if (user) goNext();
	}, [user, goNext]);

	return (
		<LandingView footer="Usamos sua conta Google apenas para identificar você.">
			{loading || user ? (
				<div className="flex justify-center py-3 text-primary">
					<CircularProgress />
				</div>
			) : (
				<SignInButton onSignedIn={goNext} />
			)}
		</LandingView>
	);
}
