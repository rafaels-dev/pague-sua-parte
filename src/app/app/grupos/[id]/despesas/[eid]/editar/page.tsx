import { NewExpenseForm } from "@/components/expenses/new-expense-form";

export const metadata = { title: "Editar despesa" };

export default async function EditarDespesaPage({ params }: Readonly<{ params: Promise<{ id: string; eid: string }> }>) {
	const { id, eid } = await params;
	return <NewExpenseForm groupId={id} editExpenseId={eid} />;
}
