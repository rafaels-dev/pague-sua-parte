"use client";

import { MockExpense, MockGroup, MockNewExpense, MockNoPixKey } from "../expense-mocks";

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
		default:
			return <MockGroup framed={false} />;
	}
}
