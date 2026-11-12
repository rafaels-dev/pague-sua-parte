import { PlanDetail } from "@/components/plans/plan-detail";

export const metadata = { title: "Plano" };

export default async function PlanoPage({ params }: Readonly<{ params: Promise<{ pid: string }> }>) {
	const { pid } = await params;
	return <PlanDetail planId={pid} />;
}
