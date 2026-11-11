import Link from "next/link";

/**
 * Aviso das telas "Pagar tudo" e "Quem me deve" abertas a partir de um grupo: diz qual grupo e deixa ver os de todos.
 * Discreto: duas linhas de texto, sem cartão.
 */
export function GroupScopeNote({ groupName, allHref }: Readonly<{ groupName: string; allHref: string }>) {
	return (
		<div className="space-y-1">
			<p className="break-words text-body-large text-on-surface-variant">
				Só do grupo <span className="font-medium text-on-surface">{groupName}</span>
			</p>
			<Link href={allHref} className="state-layer -mx-2 inline-flex min-h-12 items-center rounded-shape-md px-2 text-title-medium text-primary">
				Ver de todos os grupos
			</Link>
		</div>
	);
}
