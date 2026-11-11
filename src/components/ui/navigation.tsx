import Link from "next/link";
import { cx } from "@/lib/ui/cx";
import { Icon, type IconName } from "./icon";

export type NavItem = { href: string; label: string; icon: IconName };

/** Barra de navegação inferior (celulares). Respeita a área segura do aparelho. */
export function NavigationBar({
	items,
	activeHref,
	className,
}: Readonly<{ items: NavItem[]; activeHref: string; className?: string }>) {
	return (
		<nav
			aria-label="Principal"
			className={cx(
				"fixed inset-x-0 bottom-0 z-30 flex bg-surface-container pb-[env(safe-area-inset-bottom)] md:hidden",
				className,
			)}
		>
			{items.map((item) => {
				const active = item.href === activeHref;
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={active ? "page" : undefined}
						className="group flex min-h-20 flex-1 flex-col items-center gap-1 pb-4 pt-3 text-label-medium text-on-surface-variant aria-[current=page]:text-on-surface"
					>
						<span
							className={cx(
								"state-layer flex h-8 w-16 items-center justify-center rounded-full transition-colors duration-200 ease-out",
								active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
							)}
						>
							<Icon name={item.icon} />
						</span>
						<span className={active ? "font-bold" : ""}>{item.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}

/** Trilho de navegação (tablet e desktop), colado à esquerda. */
export function NavigationRail({
	items,
	activeHref,
	header,
	className,
}: Readonly<{ items: NavItem[]; activeHref: string; header?: React.ReactNode; className?: string }>) {
	return (
		<nav
			aria-label="Principal"
			className={cx(
				"fixed inset-y-0 left-0 z-20 hidden w-20 flex-col items-center gap-3 bg-surface py-4 md:flex",
				className,
			)}
		>
			{header && <div className="mb-4 flex h-14 items-center justify-center">{header}</div>}
			{items.map((item) => {
				const active = item.href === activeHref;
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={active ? "page" : undefined}
						className="flex min-h-14 w-full flex-col items-center gap-1 py-1 text-label-medium text-on-surface-variant aria-[current=page]:text-on-surface"
					>
						<span
							className={cx(
								"state-layer flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ease-out",
								active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
							)}
						>
							<Icon name={item.icon} />
						</span>
						<span className={active ? "font-bold" : ""}>{item.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}
