import { PlanClose } from "@/components/plans/plan-close";

export const metadata = { title: "Criar o grupo do plano" };

export default async function FecharPlanoPage({ params }: Readonly<{ params: Promise<{ pid: string }> }>) {
	const { pid } = await params;
	return <PlanClose planId={pid} />;
}
