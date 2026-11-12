import { InviteAccept } from "@/components/groups/invite-accept";

export const metadata = { title: "Convite para o grupo" };

export default async function ConvitePage({
	params,
	searchParams,
}: Readonly<{ params: Promise<{ token: string }>; searchParams: Promise<{ ir?: string | string[] }> }>) {
	const { token } = await params;
	const { ir } = await searchParams;
	// `ir` chega decodificado uma vez; a validação (grupo do convite) é feita no componente.
	return <InviteAccept token={token} destination={typeof ir === "string" ? ir : null} />;
}
