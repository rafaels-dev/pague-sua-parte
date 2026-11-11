"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { SignInButton } from "@/components/auth/sign-in-button";
import { LandingView } from "@/components/landing-view";
import { CircularProgress } from "@/components/ui";

export default function Home() {
	const router = useRouter();
	const { user, loading } = useAuth();

	useEffect(() => {
		if (user) router.replace("/app");
	}, [user, router]);

	return (
		<LandingView footer="Usamos sua conta Google apenas para identificar você.">
			{loading || user ? (
				<div className="flex justify-center py-3 text-primary">
					<CircularProgress />
				</div>
			) : (
				<SignInButton onSignedIn={() => router.replace("/app")} />
			)}
		</LandingView>
	);
}
