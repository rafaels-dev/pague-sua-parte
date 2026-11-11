import { ExpenseDetail } from "@/components/expenses/expense-detail";

export const metadata = { title: "Despesa" };

export default async function DespesaPage({ params }: Readonly<{ params: Promise<{ id: string; eid: string }> }>) {
	const { id, eid } = await params;
	return <ExpenseDetail groupId={id} expenseId={eid} />;
}
