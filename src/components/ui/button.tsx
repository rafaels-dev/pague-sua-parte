import Link from "next/link";
import { cx } from "@/lib/ui/cx";
import { Icon, type IconName } from "./icon";
import { CircularProgress } from "./progress";

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "quiet";

type Common = {
	variant?: ButtonVariant;
	icon?: IconName;
	loading?: boolean;
	/** "lg" = 56px (ações principais), "md" = 48px. */
	size?: "md" | "lg";
	fullWidth?: boolean;
	className?: string;
	children: React.ReactNode;
};
type AsButton = Common & { href?: undefined } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof Common>;
type AsLink = Common & { href: string; disabled?: boolean } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof Common | "href">;
export type ButtonProps = AsButton | AsLink;

const VARIANT: Record<ButtonVariant, string> = {
	filled: "bg-primary text-on-primary",
	tonal: "bg-secondary-container text-on-secondary-container",
	outlined: "border border-outline text-primary",
	text: "text-primary",
	/** Ação discreta, para o que importa menos: texto na cor de apoio, sem contorno. */
	quiet: "text-on-surface-variant",
};
const VARIANT_DISABLED: Record<ButtonVariant, string> = {
	filled: "bg-on-surface/12 text-on-surface/38",
	tonal: "bg-on-surface/12 text-on-surface/38",
	outlined: "border border-on-surface/12 text-on-surface/38",
	text: "text-on-surface/38",
	quiet: "text-on-surface/38",
};

export function Button(props: ButtonProps) {
	const { variant = "filled", icon, loading = false, size = "lg", fullWidth, className, children, ...rest } = props;
	const disabled = !!rest.disabled;
	const inert = disabled || loading;
	const classes = cx(
		"state-layer inline-flex select-none items-center justify-center gap-2 rounded-full text-label-large transition-[background-color,color] duration-150 ease-out",
		size === "lg" ? "h-14" : "h-12",
		variant === "text" || variant === "quiet" ? "px-4" : icon ? "pl-5 pr-6" : "px-6",
		fullWidth && "w-full",
		disabled && !loading ? VARIANT_DISABLED[variant] : VARIANT[variant],
		inert && "pointer-events-none",
		className,
	);
	const content = (
		<>
			{loading ? <CircularProgress size={20} label="" className="[&_svg]:size-5" /> : icon && <Icon name={icon} size={20} />}
			<span>{children}</span>
		</>
	);

	if (typeof rest.href === "string") {
		const { href, disabled: _unused, ...anchor } = rest as AsLink;
		void _unused;
		const aria = inert ? true : undefined;
		return /^(https?:|mailto:|tel:)/.test(href) ? (
			<a href={href} className={classes} aria-disabled={aria} {...anchor}>
				{content}
			</a>
		) : (
			<Link href={href} className={classes} aria-disabled={aria} {...anchor}>
				{content}
			</Link>
		);
	}

	const { type, href: _h, ...btn } = rest as AsButton;
	void _h;
	return (
		<button type={type ?? "button"} className={classes} aria-busy={loading || undefined} {...btn} disabled={inert}>
			{content}
		</button>
	);
}
