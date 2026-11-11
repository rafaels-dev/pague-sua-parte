import { GroupDetail } from "@/components/groups/group-detail";

export const metadata = { title: "Grupo" };

export default async function GrupoPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
	const { id } = await params;
	return <GroupDetail id={id} />;
}
