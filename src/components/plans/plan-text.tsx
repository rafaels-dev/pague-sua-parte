import { linkify } from "@/lib/ui/linkify";

/**
 * Detalhes do plano: texto livre com as quebras de linha preservadas e os endereços http/https viram link.
 * Montado só com texto e âncoras do React (nunca HTML cru); o React escapa todo o resto.
 */
export function PlanText({ text }: Readonly<{ text: string }>) {
	return (
		<p className="whitespace-pre-wrap break-words text-body-large">
			{linkify(text).map((piece, i) =>
				piece.type === "link" ? (
					<a key={i} href={piece.href} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">
						{piece.text}
					</a>
				) : (
					<span key={i}>{piece.text}</span>
				),
			)}
		</p>
	);
}
