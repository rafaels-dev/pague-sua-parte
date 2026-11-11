import { cx } from "@/lib/ui/cx";
import { Icon, type IconName } from "./icon";

const TONES = {
	attention: "bg-tertiary-container text-on-tertiary-container",
	error: "bg-error-container text-on-error-container",
} as const;

/** Aviso em linha (atenção = contêiner terciário; erro = contêiner de erro). */
export function Banner({
	title,
	children,
	action,
	tone = "attention",
	icon = "warning",
	role = "status",
	className,
}: Readonly<{
	title?: string;
	children?: React.ReactNode;
	action?: React.ReactNode;
	tone?: keyof typeof TONES;
	icon?: IconName;
	role?: "status" | "alert";
	className?: string;
}>) {
	return (
		<section role={role} className={cx("flex flex-col gap-4 rounded-shape-md p-4", TONES[tone], className)}>
			<div className="flex gap-4">
				<Icon name={icon} className="mt-0.5" />
				<div className="min-w-0 flex-1">
					{title && <p className="text-title-medium">{title}</p>}
					{children && <div className="text-body-large">{children}</div>}
				</div>
			</div>
			{action && <div className="flex md:justify-end">{action}</div>}
		</section>
	);
}
