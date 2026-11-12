import { PlanForm } from "@/components/plans/plan-form";

export const metadata = { title: "Editar plano" };

export default async function EditarPlanoPage({ params }: Readonly<{ params: Promise<{ pid: string }> }>) {
	const { pid } = await params;
	return <PlanForm planId={pid} />;
}
