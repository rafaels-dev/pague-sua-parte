import { Greeting } from "@/components/greeting";
import { GroupsList } from "@/components/groups/groups-list";
import { HomeSummaryLive } from "@/components/home-summary";
import { PixKeyWarning } from "@/components/pix-key-warning";

export const metadata = { title: "Início" };

export default function AppHome() {
	return (
		<div className="space-y-6">
			<Greeting />

			<PixKeyWarning />

			<HomeSummaryLive />

			<GroupsList />
		</div>
	);
}
