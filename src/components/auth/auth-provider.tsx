"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isAuthConfigured, onUserChanged, type ClientUser } from "@/lib/auth/client";

type AuthState = { user: ClientUser | null; loading: boolean; configured: boolean };

const AuthContext = createContext<AuthState>({ user: null, loading: true, configured: true });

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
	const [state, setState] = useState<{ user: ClientUser | null; loading: boolean }>({ user: null, loading: true });
	const configured = isAuthConfigured();

	useEffect(() => {
		if (!isAuthConfigured()) return;
		return onUserChanged((user) => setState({ user, loading: false }));
	}, []);

	const value = useMemo(
		() => ({ user: state.user, loading: configured && state.loading, configured }),
		[state, configured],
	);
	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
	return useContext(AuthContext);
}
