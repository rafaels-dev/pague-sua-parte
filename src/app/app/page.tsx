import { Greeting } from "@/components/greeting";
import { GroupsList } from "@/components/groups/groups-list";
import { HomeSummary } from "@/components/home-summary";
import { PixKeyWarning } from "@/components/pix-key-warning";

export const metadata = { title: "Início" };

export default function AppHome() {
	// TODO: valores reais virão da API (saldos por grupo).
	return (
		<div className="space-y-6">
			<Greeting />

			<PixKeyWarning />

			<HomeSummary receiveCents={0} payCents={0} />

			<GroupsList />
		</div>
	);
}
