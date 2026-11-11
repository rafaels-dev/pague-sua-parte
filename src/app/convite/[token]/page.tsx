import { InviteAccept } from "@/components/groups/invite-accept";

export const metadata = { title: "Convite para o grupo" };

export default async function ConvitePage({ params }: Readonly<{ params: Promise<{ token: string }> }>) {
	const { token } = await params;
	return <InviteAccept token={token} />;
}
