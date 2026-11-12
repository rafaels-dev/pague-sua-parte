import { after } from "next/server";
import { describeError } from "@/lib/api/http";

/**
 * Roda `work` depois de a resposta sair (`after`). Falha só vai para o log. Fora de uma requisição (testes, scripts) não faz nada:
 * avisar nunca pode atrapalhar nem atrasar a ação.
 */
export function runAfterResponse(work: () => Promise<unknown>): void {
	try {
		after(async () => {
			try {
				await work();
			} catch (err) {
				console.error("notificação error:", describeError(err));
			}
		});
	} catch {
		// sem escopo de requisição
	}
}
