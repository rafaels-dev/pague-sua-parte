import { PlanInviteAccept } from "@/components/plans/plan-invite-accept";

export const metadata = { title: "Convite para o plano" };

export default async function ConvitePlanoPage({ params }: Readonly<{ params: Promise<{ token: string }> }>) {
	const { token } = await params;
	return <PlanInviteAccept token={token} />;
}
