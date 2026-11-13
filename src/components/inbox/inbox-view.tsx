import Link from "next/link";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { cx } from "@/lib/ui/cx";
import { groupByDay, relativeTime, type InboxItem } from "@/lib/ui/inbox";

export type InboxViewProps = {
	status: "loading" | "error" | "ready";
	items: InboxItem[];
	error?: string | null;
	now: Date;
	onRetry: () => void;
	onOpen: (item: InboxItem) => void;
	onMarkAllRead: () => void;
};

function Row({ item, now, onOpen }: Readonly<{ item: InboxItem; now: Date; onOpen: (i: InboxItem) => void }>) {
	return (
		<li>
			<Link href={item.url} onClick={() => onOpen(item)} className="state-layer flex min-h-[4.5rem] items-start gap-3 px-4 py-3 text-on-surface">
				{/* Não lido: ponto + texto mais pesado (não depende só de cor). */}
				<span aria-hidden="true" className={cx("mt-2 size-2.5 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-primary")} />
				<span className="min-w-0 flex-1">
					{!item.read && <span className="sr-only">Não lido. </span>}
					<span className={cx("block break-words text-body-large", item.read ? "font-normal" : "font-semibold")}>{item.title}</span>
					<span className="block break-words text-body-large text-on-surface-variant">{item.body}</span>
					<span className="mt-1 block text-body-medium text-on-surface-variant">{relativeTime(item.createdAt, now)}</span>
				</span>
			</Link>
		</li>
	);
}

/** Página "Avisos" (visual): os avisos que foram ou deveriam ter sido enviados por push, do mais novo ao mais antigo. */
export function InboxView({ status, items, error, now, onRetry, onOpen, onMarkAllRead }: Readonly<InboxViewProps>) {
	if (status === "error") {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title="Não deu para carregar os avisos"
				action={
					<Button icon="refresh" onClick={onRetry}>
						Tentar de novo
					</Button>
				}
			>
				{error ?? "Confira sua internet e tente de novo."}
			</EmptyState>
		);
	}
	if (status === "loading") {
		return (
			<div className="space-y-3" role="status">
				<span className="sr-only">Carregando seus avisos...</span>
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
		);
	}
	const groups = groupByDay(items, now);
	const hasUnread = items.some((i) => !i.read);
	return (
		<div className="space-y-5">
			<h1 className="sr-only">Avisos</h1>
			{groups.length === 0 ? (
				<EmptyState icon="notifications" title="Nenhum aviso por aqui ainda.">
					Quando alguém pagar, lançar uma despesa ou entrar no seu grupo, o aviso aparece aqui.
				</EmptyState>
			) : (
				<>
					{hasUnread && (
						<Button variant="tonal" icon="check" fullWidth className="sm:w-auto" onClick={onMarkAllRead}>
							Marcar todas como lidas
						</Button>
					)}
					{groups.map((g) => (
						<section key={g.label} aria-labelledby={`avisos-${g.label}`} className="space-y-2">
							<h2 id={`avisos-${g.label}`} className="px-1 text-title-medium text-on-surface-variant">
								{g.label}
							</h2>
							<Card as="ul" className="divide-y divide-outline-variant/60 overflow-hidden">
								{g.items.map((i) => (
									<Row key={i.id} item={i} now={now} onOpen={onOpen} />
								))}
							</Card>
						</section>
					))}
				</>
			)}
			<p className="px-1 text-body-medium text-on-surface-variant">
				Guardamos os avisos por 90 dias.{" "}
				<Link href="/app/perfil" className="font-medium text-primary underline underline-offset-2">
					Mudar meus avisos
				</Link>
			</p>
		</div>
	);
}
