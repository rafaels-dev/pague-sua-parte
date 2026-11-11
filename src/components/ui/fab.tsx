import Link from "next/link";
import { cx } from "@/lib/ui/cx";
import { Icon, type IconName } from "./icon";

/** FAB estendido (16px de raio). Flutua acima da barra de navegação inferior. */
export function Fab({
	href,
	onClick,
	icon,
	children,
	floating = true,
	className,
}: Readonly<{
	href?: string;
	onClick?: () => void;
	icon: IconName;
	children: React.ReactNode;
	floating?: boolean;
	className?: string;
}>) {
	const classes = cx(
		"state-layer inline-flex h-14 items-center gap-3 rounded-shape-md bg-primary-container pl-4 pr-5 text-label-large text-on-primary-container shadow-elevation-3 transition-shadow duration-150",
		floating && "fixed bottom-[calc(5rem+env(safe-area-inset-bottom)+1rem)] right-4 z-20",
		className,
	);
	const body = (
		<>
			<Icon name={icon} />
			<span>{children}</span>
		</>
	);
	return href ? (
		<Link href={href} className={classes}>
			{body}
		</Link>
	) : (
		<button type="button" onClick={onClick} className={classes}>
			{body}
		</button>
	);
}
