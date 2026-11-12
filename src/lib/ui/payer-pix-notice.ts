export type PayerForNotice = { isYou: boolean; kind?: "user" | "managed"; youManage?: boolean; hasPixKey?: boolean };

/**
 * O que a tela de lançar faz quando quem pagou não tem chave Pix:
 * "block" (você sem chave, ou quem você cuida sem chave: a tela pede para cadastrar antes),
 * "warn" (administrador lançando por outra pessoa, de login ou sem celular: só avisa, pode lançar) ou "ok".
 */
export function payerPixNotice(payer: PayerForNotice, selfNoPixKey: boolean): "ok" | "warn" | "block" {
	if (payer.isYou) return selfNoPixKey ? "block" : "ok";
	if (payer.hasPixKey !== false) return "ok";
	return payer.kind === "managed" && payer.youManage ? "block" : "warn";
}
