import Link from "next/link";
import { Icon } from "@/components/ui";
import { badgeLabel, bellLabel } from "@/lib/ui/inbox";

/** Sininho do topo: leva à página de avisos. A bolinha só aparece com avisos novos e não é anunciada (o nome do botão já diz quantos). */
export function InboxBell({ unseen }: Readonly<{ unseen: number }>) {
	const badge = badgeLabel(unseen);
	return (
		<Link href="/app/avisos" aria-label={bellLabel(unseen)} className="state-layer relative flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant">
			<Icon name="notifications" />
			{badge && (
				<span
					aria-hidden="true"
					className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-label-medium font-medium text-on-error"
				>
					{badge}
				</span>
			)}
		</Link>
	);
}
