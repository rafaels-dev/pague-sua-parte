"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShellView } from "@/components/app-shell";
import { InboxProvider, useInbox } from "@/components/inbox/inbox-context";
import { useAuth } from "@/components/auth/auth-provider";
import { CircularProgress } from "@/components/ui";
import { signOut } from "@/lib/auth/client";
import { forgetThisDevice, resyncSubscription } from "@/lib/push-client";
import { useLocationSearch } from "@/lib/ui/use-location-search";
import { loginUrlFor } from "@/lib/ui/return-to";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const { user } = useAuth();
	return (
		<InboxProvider key={user?.uid ?? "anon"} enabled={Boolean(user)}>
			<AppLayoutInner>{children}</AppLayoutInner>
		</InboxProvider>
	);
}

function AppLayoutInner({ children }: Readonly<{ children: React.ReactNode }>) {
	const { unseen } = useInbox();
	const router = useRouter();
	const pathname = usePathname();
	const { user, loading } = useAuth();
	// A query string só se lê no navegador (sem useSearchParams, que exigiria Suspense): serve ao "voltar" de ?grupo=.
	const search = useLocationSearch() ?? "";

	const signingOut = useRef(false);
	const uid = user?.uid;

	useEffect(() => {
		if (uid) void resyncSubscription();
	}, [uid]);

	useEffect(() => {
		if (loading || user) return;
		// Quem ainda não entrou volta para cá depois do login (menos quem acabou de tocar em "Sair").
		const here = `${window.location.pathname}${window.location.search}`;
		router.replace(signingOut.current ? "/" : loginUrlFor(here));
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
			search={search}
			unseen={unseen}
			user={{ name: user.name, email: user.email, picture: user.picture ?? null }}
			onSignOut={() => {
				signingOut.current = true;
				// Tira os avisos deste aparelho antes de sair (precisa do login ainda ativo).
				void forgetThisDevice()
					.then(() => signOut())
					.catch(() => {
						signingOut.current = false;
					});
			}}
		>
			{children}
		</AppShellView>
	);
}
