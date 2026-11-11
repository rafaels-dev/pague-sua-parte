import { cx } from "@/lib/ui/cx";
import { Icon, type IconName } from "./icon";

/** Estado vazio ou de erro amigável: ícone em círculo tonal, título, texto e ação. */
export function EmptyState({
	icon,
	title,
	children,
	action,
	tone = "neutral",
	role,
	className,
}: Readonly<{
	icon: IconName;
	title?: string;
	children?: React.ReactNode;
	action?: React.ReactNode;
	tone?: "neutral" | "error";
	role?: "alert" | "status";
	className?: string;
}>) {
	return (
		<div role={role} className={cx("flex flex-col items-center gap-4 px-6 py-8 text-center", className)}>
			<span
				className={cx(
					"flex size-20 items-center justify-center rounded-full",
					tone === "error" ? "bg-error-container text-on-error-container" : "bg-primary-container text-on-primary-container",
				)}
			>
				<Icon name={icon} size={40} />
			</span>
			{title && <p className="text-headline-small">{title}</p>}
			{children && <div className="max-w-md text-body-large text-on-surface-variant">{children}</div>}
			{action && <div className="mt-2 flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row">{action}</div>}
		</div>
	);
}
