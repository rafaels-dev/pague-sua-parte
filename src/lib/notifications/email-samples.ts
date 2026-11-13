import type { Notice } from "./types";
import { buildWelcomeNotice } from "./welcome";

const g = { kind: "group", name: "Viagem da família" } as const;
const p = { kind: "plan", name: "Churrasco de sábado" } as const;
const g2 = { kind: "group", name: "Churrasco de sábado" } as const;
const exp = "/app/grupos/g1/despesas/e1";

/** Um aviso fictício de cada tipo que o app envia, para a pré-visualização e os testes (textos iguais aos de `messages.ts`/`plan-messages.ts`). */
export const SAMPLE_NOTICES: { id: string; notice: Notice }[] = [
	{ id: "entrou-no-grupo", notice: { uid: "u", title: "Alguém entrou no grupo", body: "Bia entrou no grupo Viagem da família.", url: "/app/grupos/g1", scope: g } },
	{ id: "pagamento-recebido", notice: { uid: "u", title: "Pagamento recebido", body: 'Bia pagou R$ 84,50 em "Aluguel da casa" (Viagem da família).', url: exp, scope: g, amountCents: 8450, amountLabel: "Valor recebido" } },
	{ id: "pagamento-parcial", notice: { uid: "u", title: "Pagamento parcial", body: 'Bia pagou R$ 40,00 de R$ 84,50 em "Aluguel da casa" (Viagem da família). Faltam R$ 44,50.', url: exp, scope: g, amountCents: 4000, amountLabel: "Valor pago agora" } },
	{ id: "parte-marcada-como-paga", notice: { uid: "u", title: "Parte marcada como paga", body: 'Ana marcou sua parte de "Mercado" (Viagem da família) como paga.', url: exp, scope: g, amountCents: 5230, amountLabel: "Valor pago" } },
	{ id: "pagamento-em-lote", notice: { uid: "u", title: "Pagamento recebido", body: "Bia pagou R$ 210,00 de 3 contas.", url: "/app/receber", amountCents: 21000, amountLabel: "Total recebido" } },
	{ id: "devolucao-recebida", notice: { uid: "u", title: "Devolução recebida", body: 'Ana devolveu R$ 12,00 de "Mercado" (Viagem da família).', url: exp, scope: g, amountCents: 1200, amountLabel: "Valor devolvido" } },
	{ id: "despesa-nova", notice: { uid: "u", title: "Nova despesa", body: 'Ana lançou "Jantar de sexta" no grupo Viagem da família. Sua parte: R$ 63,40', url: exp, scope: g, amountCents: 6340, amountLabel: "Sua parte" } },
	{ id: "despesa-parcelada", notice: { uid: "u", title: "Nova despesa", body: 'Ana lançou "Geladeira" em 10 parcelas no grupo Viagem da família. Sua parte em cada parcela: R$ 120,00', url: exp, scope: g, amountCents: 12000, amountLabel: "Sua parte em cada parcela" } },
	{ id: "despesa-parcelas-diferentes", notice: { uid: "u", title: "Nova despesa", body: 'Ana lançou "Geladeira" em 10 parcelas no grupo Viagem da família. Sua parte na primeira parcela: R$ 95,00', url: exp, scope: g, amountCents: 9500, amountLabel: "Sua parte na primeira parcela" } },
	{ id: "despesa-de-quem-cuida", notice: { uid: "u", title: "Nova despesa", body: 'Ana lançou "Mercado" no grupo Viagem da família. Sua parte e de quem você cuida: R$ 80,00', url: exp, scope: g, amountCents: 8000, amountLabel: "Sua parte e de quem você cuida" } },
	{ id: "despesa-em-seu-nome", notice: { uid: "u", title: "Despesa lançada em seu nome", body: 'Ana lançou uma despesa em seu nome: "Gasolina", R$ 200,00. Sua parte: R$ 50,00', url: exp, scope: g, amountCents: 5000, amountLabel: "Sua parte" } },
	{ id: "despesa-fixa", notice: { uid: "u", title: "Despesa fixa do mês", body: 'Nova despesa fixa: "Internet" no grupo Viagem da família. Sua parte: R$ 49,90', url: exp, scope: g, amountCents: 4990, amountLabel: "Sua parte" } },
	{ id: "incluido-na-despesa", notice: { uid: "u", title: "Você entrou numa despesa", body: 'Ana incluiu você em "Presente da avó" no grupo Viagem da família. Sua parte: R$ 25,00', url: exp, scope: g, amountCents: 2500, amountLabel: "Sua parte" } },
	{ id: "plano-fecha", notice: { uid: "u", title: "O plano fecha", body: 'O plano "Churrasco de sábado" agora fecha: R$ 45,00 para cada um.', url: "/app/planos/p1", scope: p, amountCents: 4500, amountLabel: "Cada um paga" } },
	{ id: "plano-confirmado", notice: { uid: "u", title: "Plano confirmado", body: 'O plano "Churrasco de sábado" está confirmado e o grupo "Churrasco de sábado" foi criado. Você já está no grupo.', url: "/app/grupos/g2", scope: g2 } },
	{ id: "boas-vindas", notice: buildWelcomeNotice({ uid: "u", name: "Maria Souza" }) },
	{ id: "plano-cancelado", notice: { uid: "u", title: "Plano cancelado", body: 'O plano "Churrasco de sábado" foi cancelado.', url: "/app/planos/p1", scope: p } },
	{ id: "plano-fechado-sem-voce", notice: { uid: "u", title: "Plano fechado", body: 'O plano "Churrasco de sábado" foi fechado sem você.', url: "/app/planos/p1", scope: p } },
];
