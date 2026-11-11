import Link from "next/link";
import { cx } from "@/lib/ui/cx";

/** Contêiner de lista M3 dentro de um cartão: itens separados por divisores sutis. */
export function List({
	grid = false,
	className,
	children,
}: Readonly<{ grid?: boolean; className?: string; children: React.ReactNode }>) {
	return (
		<ul
			className={cx(
				"divide-y divide-outline-variant/60 overflow-hidden rounded-shape-lg bg-surface-container-low",
				// Em telas largas, cada item vira um cartão numa grade de duas colunas.
				grid &&
					"md:grid md:grid-cols-2 md:gap-3 md:divide-y-0 md:overflow-visible md:bg-transparent md:[&>li]:overflow-hidden md:[&>li]:rounded-shape-lg md:[&>li]:bg-surface-container-low",
				className,
			)}
		>
			{children}
		</ul>
	);
}

/** Item de lista M3 (>= 56px): ícone/avatar à frente, título, texto de apoio e elemento à direita. */
export function ListItem({
	leading,
	headline,
	supporting,
	trailing,
	href,
	onClick,
	className,
}: Readonly<{
	leading?: React.ReactNode;
	headline: React.ReactNode;
	supporting?: React.ReactNode;
	trailing?: React.ReactNode;
	href?: string;
	onClick?: () => void;
	className?: string;
}>) {
	const interactive = !!(href || onClick);
	const classes = cx(
		"flex w-full items-center gap-4 px-4 text-left text-on-surface",
		supporting ? "min-h-[4.5rem] py-3" : "min-h-14 py-2",
		interactive && "state-layer",
		className,
	);
	const body = (
		<>
			{leading}
			<span className="min-w-0 flex-1">
				<span className="block break-words text-body-large font-medium text-on-surface">{headline}</span>
				{supporting && <span className="block text-body-large text-on-surface-variant">{supporting}</span>}
			</span>
			{trailing && <span className="flex shrink-0 items-center text-on-surface-variant">{trailing}</span>}
		</>
	);
	return (
		<li>
			{href ? (
				<Link href={href} className={classes}>
					{body}
				</Link>
			) : onClick ? (
				<button type="button" onClick={onClick} className={classes}>
					{body}
				</button>
			) : (
				<div className={classes}>{body}</div>
			)}
		</li>
	);
}
