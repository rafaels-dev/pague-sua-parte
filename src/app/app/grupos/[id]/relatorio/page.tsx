import { GroupReport } from "@/components/reports/group-report";

export const metadata = { title: "Relatório" };

export default async function RelatorioPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
	const { id } = await params;
	return <GroupReport groupId={id} />;
}
