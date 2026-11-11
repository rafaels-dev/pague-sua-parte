import { NewExpenseForm } from "@/components/expenses/new-expense-form";

export const metadata = { title: "Lançar despesa" };

export default async function NovaDespesaPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
	const { id } = await params;
	return <NewExpenseForm groupId={id} />;
}
