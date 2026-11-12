import { Button, EmptyState } from "@/components/ui";

/**
 * Tela de quem abriu o link de um grupo ou despesa e não faz parte do grupo.
 * Igual para "o grupo não existe" e "você não é membro": não revela nome nem existência.
 */
export function NotMemberState() {
	return (
		<EmptyState
			tone="error"
			icon="group"
			role="alert"
			title="Você ainda não está neste grupo"
			action={
				<Button href="/app" size="lg">
					Ir para o início
				</Button>
			}
		>
			Peça o convite para quem te enviou este link.
		</EmptyState>
	);
}
