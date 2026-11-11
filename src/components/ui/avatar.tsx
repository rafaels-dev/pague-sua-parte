"use client";

import { useState } from "react";
import { initialOf } from "@/lib/ui/invite";
import { cx } from "@/lib/ui/cx";

const SIZES = { sm: "size-10 text-title-medium", md: "size-12 text-title-large", lg: "size-16 text-headline-small" } as const;

/** Foto da pessoa ou, sem foto, a inicial do nome sobre um círculo tonal. */
export function Avatar({
	name,
	src,
	size = "md",
	managed = false,
	className,
}: Readonly<{ name: string; src?: string | null; size?: keyof typeof SIZES; className?: string; managed?: boolean }>) {
	const [broken, setBroken] = useState(false);
	if (src && !broken) {
		return (
			// eslint-disable-next-line @next/next/no-img-element
			<img
				src={src}
				alt=""
				referrerPolicy="no-referrer"
				onError={() => setBroken(true)}
				className={cx("shrink-0 rounded-full object-cover", SIZES[size].split(" ")[0], className)}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className={cx(
				"flex shrink-0 items-center justify-center rounded-full font-medium",
				// Pessoa sem celular: círculo na cor terciária, para nunca se confundir com quem tem conta.
				managed ? "bg-tertiary-container text-on-tertiary-container" : "bg-primary-container text-on-primary-container",
				SIZES[size],
				className,
			)}
		>
			{initialOf(name)}
		</span>
	);
}
