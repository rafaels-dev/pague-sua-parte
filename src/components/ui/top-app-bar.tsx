import { cx } from "@/lib/ui/cx";

/** Barra superior M3 (small): ícone de navegação, título e ações. O título não é um heading. */
export function TopAppBar({
	title,
	leading,
	trailing,
	className,
	innerClassName,
}: Readonly<{
	title: string;
	leading?: React.ReactNode;
	trailing?: React.ReactNode;
	className?: string;
	/** Limita a largura do conteúdo da barra (alinha com o conteúdo da página). */
	innerClassName?: string;
}>) {
	return (
		<header className={cx("sticky top-0 z-30 bg-surface", className)}>
			<div className={cx("flex h-16 items-center gap-1 px-1", innerClassName)}>
				{leading}
				<p className={cx("min-w-0 flex-1 truncate text-title-large text-on-surface", leading ? "" : "pl-3")}>{title}</p>
				{trailing && <div className="flex items-center gap-1 pr-1">{trailing}</div>}
			</div>
		</header>
	);
}
