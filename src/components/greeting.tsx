"use client";

import { useAuth } from "@/components/auth/auth-provider";

/** Saudação com o primeiro nome da conta Google; sem nome, só "Olá!". */
export function Greeting() {
	const { user } = useAuth();
	const name = user?.name ?? "";
	const firstName = name.includes("@") ? "" : name.trim().split(/\s+/)[0];

	return <h1 className="text-3xl font-bold md:text-4xl">{firstName ? `Olá, ${firstName}!` : "Olá!"}</h1>;
}
