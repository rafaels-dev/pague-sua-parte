"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShellView } from "@/components/app-shell";
import { useAuth } from "@/components/auth/auth-provider";
import { CircularProgress } from "@/components/ui";
import { signOut } from "@/lib/auth/client";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const router = useRouter();
	const pathname = usePathname();
	const { user, loading } = useAuth();

	useEffect(() => {
		if (!loading && !user) router.replace("/");
	}, [loading, user, router]);

	if (loading || !user) {
		return (
			<div className="flex min-h-dvh items-center justify-center text-primary">
				<CircularProgress />
			</div>
		);
	}

	return (
		<AppShellView
			pathname={pathname}
			user={{ name: user.name, email: user.email, picture: user.picture ?? null }}
			onSignOut={() => void signOut().catch(() => {})}
		>
			{children}
		</AppShellView>
	);
}
