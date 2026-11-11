"use client";

import { MOCK_GROUP, MockExpense, MockGroup, MockHome, MockNewExpense, MockNoPixKey } from "../expense-mocks";

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
		case "nova-escolher":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} choose={["a", "b"]} />;
		case "nova-sozinho":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} members={MOCK_GROUP.members.slice(0, 1)} />;
		case "nova-so-eu":
			return <MockNewExpense framed={false} initial={{ amountCents: 28990, description: "Remédios da farmácia" }} choose={["a"]} />;
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
		default:
			return <MockGroup framed={false} />;
	}
}
