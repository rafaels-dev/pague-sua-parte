import Link from "next/link";
import { cx } from "@/lib/ui/cx";
import { Icon, type IconName } from "./icon";

/** Botão só com ícone (alvo de toque de 48px). `label` é obrigatório por acessibilidade. */
export function IconButton({
	icon,
	label,
	href,
	onClick,
	className,
}: Readonly<{ icon: IconName; label: string; href?: string; onClick?: () => void; className?: string }>) {
	const classes = cx("state-layer flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant", className);
	if (href) {
		return (
			<Link href={href} aria-label={label} className={classes}>
				<Icon name={icon} />
			</Link>
		);
	}
	return (
		<button type="button" aria-label={label} onClick={onClick} className={classes}>
			<Icon name={icon} />
		</button>
	);
}
