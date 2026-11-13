"use client";

import { useState } from "react";
import type { ObjectId } from "mongodb";
import type { AttachmentView } from "@/components/expenses/expense-attachments";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { PlanCloseView, initialClose, type CloseValues } from "@/components/plans/plan-close";
import { PlanDetailView } from "@/components/plans/plan-detail";
import { PlanFormView, EMPTY_PLAN_VALUES, type PlanFormValues } from "@/components/plans/plan-form";
import { PlanInviteClosed, PlanInviteReady } from "@/components/plans/plan-invite-accept";
import { PlansSectionView } from "@/components/plans/plan-list";
import { Sheet } from "@/components/ui";
import { AttachmentPicker } from "@/components/expenses/attachment-picker";
import type { PlanDoc } from "@/lib/plans/collection";
import { buildPlanSummary, buildPlanView, type PlanSummary } from "@/lib/plans/view";
import { buildPlanShareText, buildPlanLink } from "@/lib/ui/plan-share";
import { Shell } from "./expense-mocks";

const noop = () => {};
const AT = new Date("2026-11-10T12:00:00Z");
const NAMES: Record<string, string> = { zeca: "Zeca", rafa: "Rafael Schettino", maria: "Maria das Dores Silva", jose: "José", lucia: "Dona Lúcia", ana: "Ana Paula", beto: "Beto", carla: "Carla", duda: "Duda", edu: "Edu" };
const info = (uid: string) => ({ name: NAMES[uid] ?? "Participante", picture: null });

const DETAILS = "Pousada Sol e Mar, 5 diárias.\nDia previsto: 27 a 31 de dezembro.\nVeja o lugar: https://pousadasolemar.example.com/quartos.\nA reserva precisa ser confirmada até o dia 20.";

function photo(label: string, color: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="${color}"/><text x="160" y="130" font-size="28" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const PHOTOS: AttachmentView[] = [
	{ id: "f1", name: "quarto.jpg", contentType: "image/jpeg", size: 120000, url: photo("Quarto", "#2f6f8f"), state: "ready" },
	{ id: "f2", name: "piscina.jpg", contentType: "image/jpeg", size: 140000, url: photo("Piscina", "#4f8f5f"), state: "ready" },
];

type Resp = [string, boolean, number?];
function doc(over: Partial<PlanDoc> & { uids: string[]; resp: Resp[] }): PlanDoc {
	const { uids, resp, ...rest } = over;
	return {
		_id: { toHexString: () => "p1" } as unknown as ObjectId,
		name: "Hotel da viagem de fim de ano",
		totalCents: 250000,
		createdBy: "rafa",
		status: "open",
		expectedPeople: 10,
		eventDate: "2026-12-27",
		deadline: "2026-12-05",
		participants: uids.map((uid) => ({ uid, joinedAt: AT })),
		guests: [{ id: "pg_1", name: "Benjamim", addedBy: "maria" }],
		responses: resp.map(([who, going, limit]) => ({ who, going, ...(limit ? { limitCents: limit } : {}), by: who, at: AT })),
		attachments: [],
		invite: null,
		version: 1,
		createdAt: AT,
		updatedAt: AT,
		...rest,
	};
}

const NINE = ["rafa", "maria", "jose", "lucia", "ana", "beto", "carla", "duda", "edu"];
const FITS = doc({ uids: NINE, resp: NINE.map((u): Resp => [u, true]), guests: [{ id: "pg_1", name: "Benjamim", addedBy: "maria" }] });
const FITS_DETAILS = { ...FITS, details: DETAILS, attachments: PHOTOS.map((p) => ({ id: p.id, key: "x", name: p.name, contentType: p.contentType, size: p.size })) };
const NOT_FIT = doc({
	uids: ["rafa", "maria", "jose", "lucia"],
	resp: [["rafa", true, 30000], ["maria", true, 25000], ["jose", false], ["pg_1", true, 25000]],
	details: undefined,
});
const ABOVE = doc({
	name: "Aluguel da casa de praia",
	totalCents: 100000,
	expectedPeople: 5,
	uids: ["rafa", "maria", "jose", "lucia"],
	resp: [["rafa", true], ["maria", true, 15000], ["jose", true, 60000], ["lucia", true], ["pg_1", true, 10000]],
});
const DONE = { ...FITS_DETAILS, status: "done" as const, groupId: "1", groupName: "Viagem de fim de ano", expenseId: "e1" };
const DONE_GROUP_ONLY: PlanDoc = { ...DONE, expenseId: undefined };
const CANCELLED = { ...FITS, status: "cancelled" as const };

export type PlanScene = "respondendo-limite" | "respondendo-limite-abaixo" | "respondendo-hoje" | "removidos" | "fecha" | "fecha-detalhes" | "nao-fecha" | "acima-limite" | "acima-limite-alto" | "acima-limite-outros" | "criador-limites" | "virou" | "virou-sem-despesa" | "cancelado" | "respondendo";

const REMOVED = { ...FITS, removed: ["zeca"] };
const TODAY_PLAN = doc({ uids: ["rafa", "maria", "ana"], resp: [["rafa", true], ["maria", true, 60000]], expectedPeople: undefined, totalCents: 150000, name: "Passeio de barco" });

const SCENES: Record<PlanScene, { plan: PlanDoc; as: string; photos?: boolean; asking?: { who: string; limitCents?: number } }> = {
	"respondendo-limite": { plan: doc({ uids: ["rafa", "ana"], resp: [["rafa", true]], expectedPeople: 10 }), as: "ana", asking: { who: "ana" } },
	"respondendo-limite-abaixo": { plan: doc({ uids: ["rafa", "ana"], resp: [["rafa", true]], expectedPeople: 10 }), as: "ana", asking: { who: "ana", limitCents: 18000 } },
	"respondendo-hoje": { plan: TODAY_PLAN, as: "ana", asking: { who: "ana" } },
	removidos: { plan: REMOVED, as: "rafa" },
	fecha: { plan: FITS, as: "ana" },
	"fecha-detalhes": { plan: FITS_DETAILS, as: "ana", photos: true },
	"nao-fecha": { plan: NOT_FIT, as: "jose" },
	"acima-limite": { plan: ABOVE, as: "maria" },
	"acima-limite-alto": { plan: { ...ABOVE, totalCents: 10000000 }, as: "maria" },
	"acima-limite-outros": { plan: ABOVE, as: "lucia" },
	"criador-limites": { plan: ABOVE, as: "rafa" },
	virou: { plan: DONE, as: "ana", photos: true },
	"virou-sem-despesa": { plan: DONE_GROUP_ONLY, as: "ana", photos: true },
	cancelado: { plan: CANCELLED, as: "ana" },
	respondendo: { plan: doc({ uids: ["rafa", "ana"], resp: [["rafa", true]], expectedPeople: 10 }), as: "ana" },
};

/** A tela do plano com dados de mentira (a conta e a privacidade do limite são as de verdade). */
export function MockPlan({ scene, framed = true }: Readonly<{ scene: PlanScene; framed?: boolean }>) {
	const s = SCENES[scene];
	const view = buildPlanView(s.plan, s.as, info, s.plan.status === "done" ? { groupId: "1" } : null);
	const [share, setShare] = useState(false);
	return (
		<Shell pathname="/app/planos/p1" framed={framed}>
			<PlanDetailView
				plan={view}
				photos={s.photos ? PHOTOS : []}
				busyWho={null}
				error={null}
				onAnswer={noop}
				onOpenImage={noop}
				onShare={() => setShare(true)}
				onAddGuest={noop}
				onRemovePerson={noop}
				onAskCancel={noop}
				onAllowReturn={noop}
				mockAsking={s.asking}
				groupHref={view.closed?.groupId ? "/app/grupos/1" : null}
				expenseHref={view.closed?.groupId && view.closed.expenseId ? "/app/grupos/1/despesas/e1" : null}
			/>
			<Sheet open={share} onClose={() => setShare(false)} title="Compartilhar o plano">
				<ShareExpenseContent
					text={buildPlanShareText(view, buildPlanLink("https://paguesuaparte.com.br", "abc123"))}
					intro="Mande o convite para quem você quer chamar. Quem abrir o link entra no plano e diz se vai."
					canShare={false}
					copyFailed={false}
					preview
					dismissLabel="Fechar"
					whatsappLabel="Enviar pelo WhatsApp"
					onCopy={noop}
					onShare={noop}
					onClose={() => setShare(false)}
				/>
			</Sheet>
		</Shell>
	);
}

export function MockPlanShare({ framed = true }: Readonly<{ framed?: boolean }>) {
	const view = buildPlanView(FITS_DETAILS, "rafa", info);
	return (
		<Shell pathname="/app/planos/p1" framed={framed}>
			<Sheet open onClose={noop} title="Compartilhar o plano">
				<ShareExpenseContent
					text={buildPlanShareText(view, buildPlanLink("https://paguesuaparte.com.br", "abc123"))}
					intro="Mande o convite para quem você quer chamar. Quem abrir o link entra no plano e diz se vai."
					canShare={false}
					copyFailed={false}
					preview
					dismissLabel="Fechar"
					whatsappLabel="Enviar pelo WhatsApp"
					onCopy={noop}
					onShare={noop}
					onClose={noop}
				/>
			</Sheet>
		</Shell>
	);
}

export function MockPlanForm({ filled = false, errors = false, framed = true }: Readonly<{ filled?: boolean; errors?: boolean; framed?: boolean }>) {
	const [values, setValues] = useState<PlanFormValues>(
		filled
			? { name: "Hotel da viagem de fim de ano", totalCents: 250000, expectedPeople: "10", eventDate: "2026-12-27", deadline: "2026-12-05", details: DETAILS }
			: EMPTY_PLAN_VALUES,
	);
	return (
		<Shell pathname="/app/planos/novo" framed={framed}>
			<PlanFormView
				values={values}
				errors={errors ? { totalCents: "Digite quanto custa no total.", name: "Dê um nome ao plano.", expectedPeople: "Escreva um número de 2 a 200." } : {}}
				busy={false}
				submitLabel="Criar plano"
				onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
				onSubmit={noop}
				photos={
					<AttachmentPicker
						items={[]}
						problems={[]}
						processing={false}
						dragging={false}
						canPaste={false}
						onPick={noop}
						onRemove={noop}
						onPaste={noop}
						imagesOnly
						copy={{ title: "Fotos", optional: true, hint: "Foto do lugar, print do anúncio. Até 3 fotos, 4 MB no total.", pick: "Anexar foto", pickAgain: "Anexar foto", inputLabel: "Escolher fotos para o plano" }}
					/>
				}
			/>
		</Shell>
	);
}

export function MockPlanClose({ fits = true, groupOnly = false, framed = true }: Readonly<{ fits?: boolean; groupOnly?: boolean; framed?: boolean }>) {
	const plan = buildPlanView(fits ? FITS : NOT_FIT, "rafa", info);
	const [values, setValues] = useState<CloseValues>(() => ({ ...initialClose(plan), withExpense: !groupOnly }));
	return (
		<Shell pathname="/app/planos/p1/fechar" framed={framed}>
			<PlanCloseView
				plan={plan}
				values={values}
				errors={{}}
				busy={false}
				onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
				onToggle={(id) => setValues((v) => ({ ...v, selected: v.selected.includes(id) ? v.selected.filter((x) => x !== id) : [...v.selected, id] }))}
				onSubmit={noop}
			/>
		</Shell>
	);
}

export function MockPlanInvite() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
			<div className="flex flex-col gap-5 rounded-shape-lg bg-surface-container-low p-6">
				<PlanInviteReady
					invite={{ planName: "Hotel da viagem de fim de ano", creatorName: "Rafael Schettino", totalCents: 250000, eventDate: "2026-12-27", allCount: 10, shareIfAllCents: 25000 }}
					accepting={false}
					acceptError={null}
					onAccept={noop}
				/>
			</div>
		</main>
	);
}

export function MockPlanInviteClosed() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
			<div className="flex flex-col gap-5 rounded-shape-lg bg-surface-container-low p-6">
				<PlanInviteClosed invite={{ planName: "Hotel da viagem de fim de ano", groupName: "Viagem de fim de ano" }} accepting={false} acceptError={null} onAccept={noop} />
			</div>
		</main>
	);
}

/** Os documentos fictícios compartilham o mesmo id; a lista precisa de chaves únicas. */
const uniqueIds = (list: PlanSummary[], prefix: string): PlanSummary[] => list.map((p, i) => ({ ...p, id: `${prefix}${i}` }));

export function MockPlanList({ framed = true }: Readonly<{ framed?: boolean }>) {
	const [showOld, setShowOld] = useState(false);
	const open = uniqueIds([buildPlanSummary(FITS, "ana"), buildPlanSummary(NOT_FIT, "jose"), buildPlanSummary(ABOVE, "lucia")], "a");
	const old = uniqueIds([buildPlanSummary(DONE, "ana"), buildPlanSummary(DONE_GROUP_ONLY, "ana"), buildPlanSummary(CANCELLED, "ana")], "o");
	return (
		<Shell pathname="/app" framed={framed}>
			<PlansSectionView plans={open} oldPlans={showOld ? old : null} loading={false} onToggleOld={() => setShowOld((s) => !s)} />
		</Shell>
	);
}

/** A seção "Planos" do Início com 0, 1 ou vários planos (para montar dentro de MockHome). */
export function MockHomePlans({ count, hasOld = false }: Readonly<{ count: 0 | 1 | 5; hasOld?: boolean }>) {
	const [showOld, setShowOld] = useState(false);
	const all = uniqueIds(
		[buildPlanSummary(FITS, "ana"), buildPlanSummary(NOT_FIT, "jose"), buildPlanSummary(ABOVE, "lucia"), buildPlanSummary(FITS, "beto"), buildPlanSummary(NOT_FIT, "carla")],
		"a",
	);
	const old = uniqueIds([buildPlanSummary(DONE, "ana"), buildPlanSummary(CANCELLED, "ana")], "o");
	return <PlansSectionView plans={all.slice(0, count)} hasOld={hasOld} oldPlans={showOld ? old : null} loading={false} onToggleOld={() => setShowOld((v) => !v)} />;
}
