"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Avatar, Button, Card, EmptyState, Icon, List, ListItem, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { InvitePanel } from "./invite-panel";

export type Member = { uid: string; name: string; picture: string | null; role: "admin" | "member"; hasPixKey: boolean; isYou: boolean };
export type Group = { id: string; name: string; role: "admin" | "member"; members: Member[] };

/** Visual da tela do grupo; o painel de convite entra como slot. */
export function GroupDetailView({ group, invite }: Readonly<{ group: Group; invite: React.ReactNode }>) {
	return (
		<div className="space-y-6">
			<h1 className="break-words text-headline-medium md:text-headline-large">{group.name}</h1>

			<div className="grid items-start gap-6 md:grid-cols-2">
				<div className="space-y-6">
					{invite}

					<section className="space-y-3" aria-labelledby="despesas-titulo">
						<h2 id="despesas-titulo" className="text-title-large">
							Despesas
						</h2>
						<Card variant="outlined" className="p-6 text-center">
							<p className="text-body-large text-on-surface-variant">Em breve você poderá registrar as despesas do grupo por aqui.</p>
						</Card>
					</section>
				</div>

				<section className="space-y-3" aria-labelledby="membros-titulo">
					<h2 id="membros-titulo" className="text-title-large">
						Pessoas do grupo
					</h2>
					<List>
						{group.members.map((m) => {
							const notes = [m.role === "admin" && "Administra o grupo", !m.hasPixKey && "Sem chave Pix"].filter(Boolean);
							return (
								<ListItem
									key={m.uid}
									leading={<Avatar name={m.name} src={m.picture} />}
									headline={
										<>
											{m.name}
											{m.isYou && <span className="font-normal text-on-surface-variant"> (você)</span>}
										</>
									}
									supporting={notes.length ? notes.join(" · ") : undefined}
									trailing={!m.hasPixKey ? <Icon name="warning" className="text-on-surface-variant" /> : undefined}
								/>
							);
						})}
					</List>
				</section>
			</div>
		</div>
	);
}

export function GroupDetailSkeleton() {
	return (
		<div role="status" className="space-y-6">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-10 w-2/3" />
			<Skeleton className="h-14 w-full rounded-full md:w-56" />
			<div className="space-y-3">
				<Skeleton className="h-[4.5rem] rounded-shape-md" />
				<Skeleton className="h-[4.5rem] rounded-shape-md" />
			</div>
		</div>
	);
}

export function GroupDetail({ id }: Readonly<{ id: string }>) {
	const { user } = useAuth();
	const [group, setGroup] = useState<Group | null>(null);
	const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<Group>(`/api/groups/${encodeURIComponent(id)}`)
			.then((g) => {
				if (!cancelled) setGroup(g);
			})
			.catch((e) => {
				if (cancelled) return;
				if (e instanceof ApiError) setError({ message: e.message, notFound: e.status === 404 });
				else setError({ message: "Não foi possível carregar o grupo.", notFound: false });
			});
		return () => {
			cancelled = true;
		};
	}, [user, id, reloadKey]);

	if (error) {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title={error.notFound ? "Grupo não encontrado" : "Ops!"}
				action={
					<>
						{!error.notFound && (
							<Button
								icon="refresh"
								onClick={() => {
									setError(null);
									setReloadKey((k) => k + 1);
								}}
							>
								Tentar de novo
							</Button>
						)}
						<Button href="/app" variant={error.notFound ? "filled" : "outlined"}>
							Voltar para o início
						</Button>
					</>
				}
			>
				{error.notFound ? "Esse grupo não existe ou você não faz parte dele." : error.message}
			</EmptyState>
		);
	}

	if (!group) return <GroupDetailSkeleton />;

	return (
		<GroupDetailView
			group={group}
			invite={<InvitePanel groupId={group.id} groupName={group.name} isAdmin={group.role === "admin"} />}
		/>
	);
}
