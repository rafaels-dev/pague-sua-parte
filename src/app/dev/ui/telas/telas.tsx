"use client";

import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { InviteErrorContent, InviteMemberContent, InviteShell } from "@/components/groups/invite-accept";
import { MemberSheetContent } from "@/components/groups/member-sheet";
import { GroupDetailView } from "@/components/groups/group-detail";
import { ExpenseListView } from "@/components/expenses/expense-list";
import { Button } from "@/components/ui";
import { NotMemberState } from "@/components/groups/not-member";
import { buildExpenseShareText, shareIntro } from "@/lib/ui/expense-share";
import { expenseShareLink, SOLO_SHARE_EXPENSE_HINT, SOLO_SHARE_NOTICE } from "@/lib/ui/share-link";
import { MockPixRefused } from "../pix-mocks";
import { GoogleButtonView } from "@/components/auth/sign-in-button";
import { LandingView } from "@/components/landing-view";
import { todayISO } from "@/lib/ui/dates";
import { nextDayOfMonth } from "@/lib/ui/due-dates";
import { MockHomePlans, MockPlan, MockPlanClose, MockPlanForm, MockPlanInvite, MockPlanInviteClosed, MockPlanList, MockPlanShare } from "../plan-mocks";
import { buildAdvanceShareText } from "@/lib/payments/advance";
import { MockPayAll } from "../pay-all-mocks";
import { MockReceivables } from "../receivables-mocks";
import { DUE_GROUPS, MOCK_GROUP, Shell as MockShell, MockExpense, MockGroup, MockHome, MockManagedSheet, MockNewExpense, MockNoPixKey, MockRecurrenceSheet, MockReport } from "../expense-mocks";

const ORIGIN = "https://paguesuaparte.com.br";

function ShareSheetMock({ notice, loading = false }: Readonly<{ notice?: string; loading?: boolean }>) {
	return (
		<main className="mx-auto w-full max-w-md space-y-4 bg-surface-container-low p-5">
			<h1 className="text-headline-small">Despesa lançada!</h1>
			<ShareExpenseContent
				text={buildExpenseShareText({ amountCents: 15000, description: "Mercado" }, expenseShareLink("launched", ORIGIN, "abc123", "1", "e1"))}
				intro={shareIntro("launched")}
				notice={notice}
				loading={loading}
				canShare
				copyFailed={false}
				preview
				onCopy={() => {}}
				onShare={() => {}}
				onClose={() => {}}
			/>
		</main>
	);
}

function AdvanceShareMock() {
	return (
		<main className="mx-auto w-full max-w-md space-y-4 bg-surface-container-low p-5">
			<h1 className="text-headline-small">Avisar no WhatsApp</h1>
			<ShareExpenseContent
				text={buildAdvanceShareText(
					{
						totalCents: 34700,
						description: "Sofá da sala",
						hasReceipt: true,
						items: [
							{ number: 1, cents: 10000, settled: true, remainingCents: 0 },
							{ number: 2, cents: 10000, settled: true, remainingCents: 0 },
							{ number: 3, cents: 10000, settled: true, remainingCents: 0 },
							{ number: 4, cents: 4700, settled: false, remainingCents: 5300 },
						],
					},
					expenseShareLink("paid", ORIGIN, null, "1", "p1"),
				)}
				intro="Mande para Maria das Dores Silva saber que você pagou. O link abre a despesa com o seu comprovante."
				canShare
				copyFailed={false}
				preview
				onCopy={() => {}}
				onShare={() => {}}
				onClose={() => {}}
			/>
		</main>
	);
}

export function Telas({ tela }: Readonly<{ tela: string }>) {
	switch (tela) {
		case "landing":
			return (
				<LandingView footer="Usamos sua conta Google apenas para identificar você.">
					<GoogleButtonView />
				</LandingView>
			);
		case "admin-despesa":
			return <MockExpense mode="admin-view" framed={false} />;
		case "admin-despesa-resumo":
			return <MockExpense mode="admin-view" summarySheet framed={false} />;
		case "admin-lanca":
			return <MockNewExpense framed={false} admin initial={{ amountCents: 62000, description: "Mercado do mês" }} />;
		case "admin-lanca-por-outro":
			return <MockNewExpense framed={false} admin payer="b" initial={{ amountCents: 62000, description: "Mercado do mês" }} />;
		case "admin-lanca-sem-pix":
			return <MockNewExpense framed={false} admin payer="d" initial={{ amountCents: 62000, description: "Mercado do mês" }} />;
		case "admin-lancada-por":
			return <MockExpense mode="admin-launched" framed={false} />;
		case "devolver-pix":
			return <MockExpense mode="refund-pay" framed={false} />;
		case "devolver-sem-pix":
			return <MockExpense mode="refund-nopix" framed={false} />;
		case "devolvi-comprovante":
			return <MockExpense mode="refund-pay" receiptSheet={{ mode: "refund", filled: true }} framed={false} />;
		case "devolucao-feita":
			return <MockExpense mode="refund-done" framed={false} />;
		case "grupo-resumo":
			return <MockGroup summary="valores" summarySheet framed={false} />;
		case "editar-despesa":
			return <MockNewExpense framed={false} editing initial={{ amountCents: 45000, description: "Consulta com a cardiologista" }} />;
		case "pagar-tudo-devolucao":
			return <MockPayAll scene="devolucao" framed={false} />;
		case "quem-me-deve-devolucao":
			return <MockReceivables scene="devolucao" framed={false} />;
		case "grupo-vazio":
			return <MockGroup empty framed={false} />;
		case "plano-fecha":
			return <MockPlan scene="fecha" framed={false} />;
		case "plano-fecha-detalhes":
			return <MockPlan scene="fecha-detalhes" framed={false} />;
		case "plano-nao-fecha":
			return <MockPlan scene="nao-fecha" framed={false} />;
		case "plano-acima-limite":
			return <MockPlan scene="acima-limite" framed={false} />;
		case "plano-acima-limite-alto":
			return <MockPlan scene="acima-limite-alto" framed={false} />;
		case "plano-acima-limite-outros":
			return <MockPlan scene="acima-limite-outros" framed={false} />;
		case "plano-criador-limites":
			return <MockPlan scene="criador-limites" framed={false} />;
		case "plano-virou":
			return <MockPlan scene="virou" framed={false} />;
		case "plano-virou-sem-despesa":
			return <MockPlan scene="virou-sem-despesa" framed={false} />;
		case "plano-cancelado":
			return <MockPlan scene="cancelado" framed={false} />;
		case "plano-responder":
			return <MockPlan scene="respondendo" framed={false} />;
		case "plano-responder-limite":
			return <MockPlan scene="respondendo-limite" framed={false} />;
		case "plano-responder-limite-abaixo":
			return <MockPlan scene="respondendo-limite-abaixo" framed={false} />;
		case "plano-responder-hoje":
			return <MockPlan scene="respondendo-hoje" framed={false} />;
		case "plano-removidos":
			return <MockPlan scene="removidos" framed={false} />;
		case "plano-compartilhar":
			return <MockPlanShare framed={false} />;
		case "plano-novo":
			return <MockPlanForm framed={false} />;
		case "plano-novo-preenchido":
			return <MockPlanForm filled framed={false} />;
		case "plano-novo-erros":
			return <MockPlanForm errors framed={false} />;
		case "plano-fechar":
			return <MockPlanClose framed={false} />;
		case "plano-fechar-so-grupo":
			return <MockPlanClose groupOnly framed={false} />;
		case "plano-fechar-nao-fecha":
			return <MockPlanClose fits={false} framed={false} />;
		case "plano-convite":
			return <MockPlanInvite />;
		case "plano-convite-confirmado":
			return <MockPlanInviteClosed />;
		case "plano-convite-vencido":
			return (
				<InviteShell>
					<InviteErrorContent message="Este plano já virou o grupo e o link não vale mais. Peça o link do grupo a quem te convidou." onRetry={() => {}} />
				</InviteShell>
			);
		case "grupo-remover":
			return (
				<MockShell pathname="/app/grupos/1" framed={false}>
					<div className="space-y-4 rounded-shape-lg bg-surface-container-low p-5">
						<h2 className="text-title-large">Maria das Dores Silva</h2>
						<MemberSheetContent member={{ name: "Maria das Dores Silva", role: "member" }} busy={false} error={null} confirmingRemove allowReturn onAllowReturn={() => {}} onToggleRole={() => {}} onAskRemove={() => {}} onCancelRemove={() => {}} onConfirmRemove={() => {}} />
					</div>
				</MockShell>
			);
		case "grupo-nao-voltam":
			return (
				<MockShell pathname="/app/grupos/1" framed={false}>
					<GroupDetailView
						group={{ ...MOCK_GROUP, role: "admin", blocked: [{ uid: "x1", name: "Carlos Pereira" }, { uid: "x2", name: "Maria das Dores Silva" }] }}
						invite={<Button icon="share" fullWidth className="md:w-auto">Convidar pessoas</Button>}
						expenses={<ExpenseListView groupId="1" state={{ kind: "ready", expenses: [] }} />}
						onAllowReturn={() => {}}
					/>
				</MockShell>
			);
		case "plano-lista":
			return <MockPlanList framed={false} />;
		case "nao-membro":
			return (
				<MockShell pathname="/app/grupos/1" framed={false}>
					<NotMemberState />
				</MockShell>
			);
		case "compartilhar-solo":
			return <ShareSheetMock notice={`${SOLO_SHARE_NOTICE} ${SOLO_SHARE_EXPENSE_HINT}`} />;
		case "compartilhar-sem-aviso":
			return <ShareSheetMock />;
		case "compartilhar-carregando":
			return <ShareSheetMock loading />;
		case "convite-erro":
			return (
				<InviteShell>
					<InviteErrorContent message="Este convite não é mais válido. Peça um novo link a quem te convidou." onRetry={() => {}} />
				</InviteShell>
			);
		case "convite-membro-aviso":
			return (
				<InviteShell>
					<InviteMemberContent groupId="1" groupName="Família Silva" memberCount={5} badDestination />
				</InviteShell>
			);
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
		case "pix-recusado":
			return <MockPixRefused />;
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
		case "parcial-pagar-outro-valor":
			return <MockExpense mode="partial" otherAmount={4700} framed={false} />;
		case "parcial-pagar-outro-valor-vazio":
			return <MockExpense mode="partial" otherAmount={0} framed={false} />;
		case "parcial-pagar-outro-valor-maior":
			return <MockExpense mode="partial" otherAmount={9000} framed={false} />;
		case "parcial-ja-paguei":
			return <MockExpense mode="partial" receiptSheet={{ mode: "pay", filled: true }} framed={false} />;
		case "parcial-dono":
			return <MockExpense mode="partial-owner" framed={false} />;
		case "parcial-recebi":
			return <MockExpense mode="partial-owner" confirm={{ uid: "b", mode: "paid" }} framed={false} />;
		case "parcial-recebi-parte":
			return <MockExpense mode="partial-owner" confirm={{ uid: "b", mode: "paid" }} receivePartial framed={false} />;
		case "parcial-desfazer":
			return <MockExpense mode="partial-owner" confirm={{ uid: "b", mode: "pending" }} framed={false} />;
		case "parcial-desfazer-quitacao":
			return <MockExpense mode="partial-owner" confirm={{ uid: "e", mode: "pending" }} framed={false} />;
		case "parcial-desfazer-meu":
			return <MockExpense mode="partial" confirm={{ uid: "a", mode: "pending" }} framed={false} />;
		case "parcial-parcela":
			return <MockExpense mode="partial-installment" framed={false} />;
		case "adiantar-parcela":
			return <MockExpense mode="advance-start" framed={false} />;
		case "adiantar-carregando":
			return <MockExpense mode="advance-start" advance={{ mode: "self", cents: null }} framed={false} />;
		case "adiantar-vazio":
			return <MockExpense mode="advance-start" advance={{ mode: "self", cents: 0 }} framed={false} />;
		case "adiantar-347":
			return <MockExpense mode="advance-start" advance={{ mode: "self", cents: 34700 }} framed={false} />;
		case "adiantar-maior":
			return <MockExpense mode="advance-start" advance={{ mode: "self", cents: 120000 }} framed={false} />;
		case "adiantar-antiga-aberta":
			return <MockExpense mode="advance-older" advance={{ mode: "self", cents: 25000 }} framed={false} />;
		case "adiantar-dois-destinatarios":
			return <MockExpense mode="advance-two-recipients" advance={{ mode: "self", cents: 15000 }} framed={false} />;
		case "adiantar-depois-4":
			return <MockExpense mode="advance-done" framed={false} />;
		case "adiantar-depois-1":
			return <MockExpense mode="advance-done-first" framed={false} />;
		case "adiantar-dono":
			return <MockExpense mode="advance-owner" framed={false} />;
		case "adiantar-dono-recebi":
			return <MockExpense mode="advance-owner" confirm={{ uid: "b", mode: "paid" }} framed={false} />;
		case "adiantar-dono-347":
			return <MockExpense mode="advance-owner" advance={{ mode: "manual", cents: 34700 }} framed={false} />;
		case "adiantar-dono-depois":
			return <MockExpense mode="advance-owner-done" framed={false} />;
		case "adiantar-whatsapp":
			return <AdvanceShareMock />;
		case "parcial-pagar-tudo":
			return <MockPayAll framed={false} scene="parte-paga" />;
		case "parcial-quem-me-deve":
			return <MockReceivables framed={false} scene="parte-paga" />;
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
		case "home-sem-plano":
			return (
				<MockHome framed={false}>
					<MockHomePlans count={0} />
				</MockHome>
			);
		case "home-so-antigos":
			return (
				<MockHome framed={false}>
					<MockHomePlans count={0} hasOld />
				</MockHome>
			);
		case "home-um-plano":
			return (
				<MockHome framed={false}>
					<MockHomePlans count={1} hasOld />
				</MockHome>
			);
		case "home-varios-planos":
			return (
				<MockHome framed={false}>
					<MockHomePlans count={5} hasOld />
				</MockHome>
			);
		case "home-novo-usuario":
			return (
				<MockHome framed={false} groups={[]} summary={{ receiveCents: 0, payCents: 0 }}>
					<MockHomePlans count={0} />
				</MockHome>
			);
		case "home-escolher-grupo":
			return <MockHome framed={false} chooser />;
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
		case "nova-cashback":
			return <MockNewExpense framed={false} initial={{ amountCents: 100000, description: "Compras do mês" }} cashback={{ cents: 5000 }} />;
		case "nova-cashback-parcelado":
			return (
				<MockNewExpense
					framed={false}
					initial={{ amountCents: 30000, description: "Geladeira nova" }}
					pay={{ payment: "installments", dueDate: nextDayOfMonth(todayISO(), 10), installments: 3 }}
					cashback={{ cents: 5000, mode: "first" }}
				/>
			);
		case "nova-cashback-parcelado-dividido":
			return (
				<MockNewExpense
					framed={false}
					initial={{ amountCents: 30000, description: "Geladeira nova" }}
					pay={{ payment: "installments", dueDate: nextDayOfMonth(todayISO(), 10), installments: 4 }}
					cashback={{ cents: 5003 }}
				/>
			);
		case "nova-cashback-erro":
			return (
				<MockNewExpense
					framed={false}
					initial={{ amountCents: 30000, description: "Geladeira nova" }}
					pay={{ payment: "installments", dueDate: nextDayOfMonth(todayISO(), 10), installments: 3 }}
					cashback={{ cents: 30000, mode: "first" }}
				/>
			);
		case "despesa-cashback":
			return <MockExpense mode="cashback" framed={false} />;
		case "despesa-cashback-parcela":
			return <MockExpense mode="cashback-installment" framed={false} />;
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
		case "fixa-nova":
			return <MockNewExpense framed={false} initial={{ amountCents: 120000, description: "Aluguel da casa da vó" }} pay={{ payment: "monthly", dayOfMonth: 25 }} />;
		case "fixa-nova-fim":
			return <MockNewExpense framed={false} initial={{ amountCents: 32000, description: "Cuidadora de sábado" }} pay={{ payment: "monthly", dayOfMonth: 31, endPeriod: "" }} errors={{ endPeriod: "Escolha o mês em que termina." }} />;
		case "fixa-nova-erro-dia":
			return (
				<MockNewExpense
					framed={false}
					initial={{ amountCents: 120000, description: "Aluguel da casa da vó" }}
					pay={{ payment: "monthly", dayOfMonth: 25 }}
					errors={{ dayOfMonth: "O dia precisa ser de 1 a 31." }}
				/>
			);
		case "fixa-nova-indisponivel":
			return (
				<MockNewExpense
					framed={false}
					initial={{ amountCents: 120000, description: "Aluguel da casa da vó" }}
					pay={{ payment: "monthly", dayOfMonth: 25 }}
					errors={{ form: "Despesas fixas ainda não estão disponíveis. Tente de novo mais tarde." }}
				/>
			);
		case "grupo-fixas-fechado":
			return <MockGroup framed={false} fixed="closed" />;
		case "grupo-fixas-aberto":
			return <MockGroup framed={false} fixed="open" />;
		case "fixa-opcoes":
			return <MockRecurrenceSheet framed={false} view="options" />;
		case "fixa-editar":
			return <MockRecurrenceSheet framed={false} view="edit" />;
		case "fixa-encerrar":
			return <MockRecurrenceSheet framed={false} view="end" />;
		case "despesa-todo-mes":
			return <MockExpense mode="monthly" framed={false} />;
		case "pagar-home":
			return (
				<MockHome
					framed={false}
					groups={DUE_GROUPS}
					summary={{ receiveNowCents: 30000, payNowCents: 45000, overdueCents: 12000, payAll: true }}
				/>
			);
		case "pagar-tudo":
			return <MockPayAll framed={false} />;
		case "pagar-tudo-pix":
			return <MockPayAll framed={false} scene="pix" />;
		case "pagar-tudo-desmarcado":
			return <MockPayAll framed={false} scene="desmarcado" />;
		case "pagar-tudo-nada":
			return <MockPayAll framed={false} scene="nada" />;
		case "pagar-tudo-comprovante":
			return <MockPayAll framed={false} scene="comprovante" />;
		case "pagar-tudo-comprovante-arquivo":
			return <MockPayAll framed={false} scene="comprovante-arquivo" />;
		case "pagar-tudo-pago":
			return <MockPayAll framed={false} scene="pago" />;
		case "pagar-tudo-avisar":
			return <MockPayAll framed={false} scene="avisar" />;
		case "pagar-tudo-parcial":
			return <MockPayAll framed={false} scene="parcial" />;
		case "pagar-tudo-vazio":
			return <MockPayAll framed={false} scene="vazio" />;
		case "pagar-tudo-carregando":
			return <MockPayAll framed={false} scene="carregando" />;
		case "pagar-tudo-erro":
			return <MockPayAll framed={false} scene="erro" />;
		case "pagar-tudo-indisponivel":
			return <MockPayAll framed={false} scene="indisponivel" />;
		case "receber-home":
			return (
				<MockHome
					framed={false}
					groups={DUE_GROUPS}
					managed={[{ uid: "m1", name: "Benjamim", groupId: "1", groupName: "Despesas da família", toReceiveCents: 14500, toPayCents: 0, toReceiveNowCents: 14500, toPayNowCents: 0, overdueToPayCents: 0 }]}
					summary={{ receiveNowCents: 30000, payNowCents: 45000, overdueCents: 12000, payAll: true, receivable: true }}
				/>
			);
		case "receber":
			return <MockReceivables framed={false} />;
		case "receber-whatsapp":
			return <MockReceivables framed={false} scene="whatsapp" />;
		case "receber-whatsapp-cuidado":
			return <MockReceivables framed={false} scene="whatsapp-cuidado" />;
		case "receber-vazio":
			return <MockReceivables framed={false} scene="vazio" />;
		case "receber-carregando":
			return <MockReceivables framed={false} scene="carregando" />;
		case "receber-erro":
			return <MockReceivables framed={false} scene="erro" />;
		case "receber-indisponivel":
			return <MockReceivables framed={false} scene="indisponivel" />;
		case "grupo-resumo":
			return <MockGroup framed={false} care summary="valores" />;
		case "grupo-resumo-em-dia":
			return <MockGroup framed={false} care summary="em-dia" />;
		case "grupo-resumo-carregando":
			return <MockGroup framed={false} care summary="carregando" />;
		case "pagar-tudo-grupo":
			return <MockPayAll framed={false} scene="grupo" />;
		case "pagar-tudo-grupo-vazio":
			return <MockPayAll framed={false} scene="grupo-vazio" />;
		case "receber-grupo":
			return <MockReceivables framed={false} scene="grupo" />;
		case "receber-grupo-vazio":
			return <MockReceivables framed={false} scene="grupo-vazio" />;
		case "despesa-pago-junto":
			return <MockExpense mode="batch" framed={false} />;
		default:
			return <MockGroup framed={false} />;
	}
}
