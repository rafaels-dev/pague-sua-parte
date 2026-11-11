"use client";

import { todayISO } from "@/lib/ui/dates";
import { nextDayOfMonth } from "@/lib/ui/due-dates";
import { DUE_GROUPS, MOCK_GROUP, MockExpense, MockGroup, MockHome, MockManagedSheet, MockNewExpense, MockNoPixKey, MockReport } from "../expense-mocks";

export function Telas({ tela }: Readonly<{ tela: string }>) {
	switch (tela) {
		case "grupo-vazio":
			return <MockGroup empty framed={false} />;
		case "nova":
			return <MockNewExpense framed={false} />;
		case "nova-preenchida":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} />;
		case "nova-erros":
			return (
				<MockNewExpense
					framed={false}
					errors={{
						amount: "Digite quanto custou.",
						description: "Escreva o que foi a despesa.",
						participants: "Escolha pelo menos uma pessoa além de você.",
						form: "Não foi possível lançar a despesa. Tente de novo.",
					}}
				/>
			);
		case "sem-pix":
			return <MockNoPixKey framed={false} />;
		case "devo":
			return <MockExpense mode="debtor" framed={false} />;
		case "comprovante-devo":
			return <MockExpense mode="debtor" framed={false} />;
		case "comprovante-sheet-vazio":
			return <MockExpense mode="debtor" receiptSheet={{ mode: "pay" }} framed={false} />;
		case "comprovante-sheet-arquivo":
			return <MockExpense mode="debtor" receiptSheet={{ mode: "pay", filled: true }} framed={false} />;
		case "comprovante-dono":
			return <MockExpense mode="self-owner" framed={false} />;
		case "comprovante-depois-de-pagar":
			return <MockExpense mode="self-debtor" framed={false} />;
		case "comprovante-anexar":
			return <MockExpense mode="self-debtor" receiptSheet={{ mode: "attach" }} framed={false} />;
		case "devo-qr":
			return <MockExpense mode="debtor" qrOpen framed={false} />;
		case "devo-sem-copiar":
			return <MockExpense mode="debtor" codeFallback framed={false} />;
		case "paguei":
			return <MockExpense mode="payer" framed={false} />;
		case "paguei-confirmar":
			return <MockExpense mode="payer" confirm={{ uid: "c", mode: "paid" }} framed={false} />;
		case "paguei-desfazer":
			return <MockExpense mode="payer" confirm={{ uid: "b", mode: "pending" }} framed={false} />;
		case "nova-escolher":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} choose={["a", "b"]} />;
		case "nova-sozinho":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} members={MOCK_GROUP.members.slice(0, 1)} />;
		case "nova-so-eu":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} alone />;
		case "nova-escolher-so-eu":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} choose={["a"]} />;
		case "despesa-quero-ajudar":
			return <MockExpense mode="help-alone" framed={false} />;
		case "despesa-quero-ajudar-dividida":
			return <MockExpense mode="help-split" framed={false} />;
		case "despesa-quero-ajudar-confirmar":
			return <MockExpense mode="help-alone" helpSheet framed={false} />;
		case "despesa-quero-ajudar-cuidado":
			return <MockExpense mode="help-care" helpSheet framed={false} />;
		case "despesa-ajudou":
			return <MockExpense mode="helped" framed={false} />;
		case "grupo-esperando-ajuda":
			return <MockGroup help framed={false} />;
		case "relatorio":
			return <MockReport variant="even" />;
		case "relatorio-desigual":
			return <MockReport variant="uneven" />;
		case "relatorio-vazio":
			return <MockReport variant="empty" />;
		case "relatorio-indisponivel":
			return <MockReport state={{ kind: "unavailable", onRetry: () => {} }} />;
		case "recalcular":
			return <MockExpense mode="recalc" resplit={["a", "b", "c"]} framed={false} />;
		case "recalcular-entra":
			return <MockExpense mode="owner-return" resplit={["a", "b", "c", "d"]} framed={false} />;
		case "devo-parcial":
			return <MockExpense mode="partial" framed={false} />;
		case "receber-de-volta":
			return <MockExpense mode="refund" framed={false} />;
		case "dono-devolver":
			return <MockExpense mode="owner-return" framed={false} />;
		case "dono-devolver-confirmar":
			return <MockExpense mode="owner-return" confirm={{ uid: "d", mode: "refund" }} framed={false} />;
		case "despesa-lancada":
			return <MockExpense mode="payer" shareSheet framed={false} />;
		case "home-grupos":
			return <MockHome framed={false} />;
		case "home-escolher-grupo":
			return <MockHome framed={false} chooser />;
		case "home-sem-grupo":
			return <MockHome framed={false} chooser groups={[]} />;
		case "grupo-sem-celular":
			return <MockGroup care framed={false} />;
		case "adicionar-sem-celular":
			return <MockManagedSheet framed={false} />;
		case "adicionar-sem-celular-preenchido":
			return <MockManagedSheet framed={false} filled />;
		case "adicionar-sem-celular-erros":
			return <MockManagedSheet framed={false} filled errors={{ name: "Escreva o nome da pessoa.", pixKey: "Chave Pix inválida. Confira o número ou e-mail digitado." }} />;
		case "sem-celular-opcoes":
			return <MockManagedSheet framed={false} view="options" />;
		case "sem-celular-remover":
			return <MockManagedSheet framed={false} view="remove" />;
		case "sem-celular-editar":
			return <MockManagedSheet framed={false} view="edit" />;
		case "sem-celular-responsavel":
			return <MockManagedSheet framed={false} view="carer" />;
		case "nova-quem-pagou":
			return <MockNewExpense framed={false} care payer="m1" initial={{ amountCents: 28990, description: "Remédios do Benjamim" }} />;
		case "nova-quem-pagou-eu":
			return <MockNewExpense framed={false} care initial={{ amountCents: 28990, description: "Remédios da farmácia" }} />;
		case "nova-quem-pagou-sem-pix":
			return <MockNewExpense framed={false} care payer="m3" initial={{ amountCents: 28990, description: "Remédios do tio" }} />;
		case "despesa-duas-partes":
			return <MockExpense mode="two-parts" framed={false} />;
		case "despesa-duas-partes-qr":
			return <MockExpense mode="two-parts" qrOpen framed={false} />;
		case "despesa-cuidado-pagou":
			return <MockExpense mode="care-paid" framed={false} />;
		case "home-cuidados":
			return (
				<MockHome
					framed={false}
					managed={[
						{ uid: "m1", name: "Benjamim", groupId: "1", groupName: "Despesas da família", toReceiveCents: 14500, toPayCents: 10333, toReceiveNowCents: 14500, toPayNowCents: 10333, overdueToPayCents: 0 },
						{ uid: "m3", name: "Tio Carlos", groupId: "1", groupName: "Despesas da família", toReceiveCents: 0, toPayCents: 0, toReceiveNowCents: 0, toPayNowCents: 0, overdueToPayCents: 0 },
					]}
				/>
			);
		case "nova-cartao":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} pay={{ payment: "card" }} />;
		case "nova-parcelado":
			return (
				<MockNewExpense
					framed={false}
					initial={{ amountCents: 12000, description: "Geladeira nova" }}
					pay={{ payment: "installments", dueDate: nextDayOfMonth(todayISO(), 10), installments: 6 }}
				/>
			);
		case "nova-parcelado-erros":
			return (
				<MockNewExpense
					framed={false}
					initial={{ amountCents: 12000, description: "Geladeira nova" }}
					pay={{ payment: "installments", installments: 6 }}
					errors={{ dueDate: "Escolha quando vence a primeira parcela." }}
				/>
			);
		case "despesa-parcela":
			return <MockExpense mode="installment" framed={false} />;
		case "despesa-parcela-dono":
			return <MockExpense mode="owner-installment" framed={false} />;
		case "despesa-parcela-lancada":
			return <MockExpense mode="owner-installment" shareSheet framed={false} />;
		case "despesa-vencida":
			return <MockExpense mode="overdue" framed={false} />;
		case "apagar-parcela-escopo":
			return <MockExpense mode="owner-installment" scopeSheet="delete" framed={false} />;
		case "mudar-parcela-escopo":
			return <MockExpense mode="owner-installment" scopeSheet="resplit" framed={false} />;
		case "grupo-vencimentos":
			return <MockGroup due framed={false} />;
		case "home-vencimentos":
			return (
				<MockHome
					framed={false}
					groups={DUE_GROUPS}
					summary={{ receiveNowCents: 30000, payNowCents: 45000, overdueCents: 12000 }}
					managed={[
						{ uid: "m1", name: "Benjamim", groupId: "1", groupName: "Despesas da família", toReceiveCents: 14500, toPayCents: 30333, toReceiveNowCents: 14500, toPayNowCents: 10333, overdueToPayCents: 0 },
						{ uid: "m3", name: "Tio Carlos", groupId: "1", groupName: "Despesas da família", toReceiveCents: 0, toPayCents: 8000, toReceiveNowCents: 0, toPayNowCents: 8000, overdueToPayCents: 2500 },
					]}
				/>
			);
		default:
			return <MockGroup framed={false} />;
	}
}
