"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ExpenseAttachments, type AttachmentView } from "@/components/expenses/expense-attachments";
import { ShareExpenseContent } from "@/components/expenses/expense-share";
import { clearFlash, peekFlash, setFlash } from "@/components/expenses/types";
import { Avatar, Banner, Button, Card, EmptyState, IconButton, List, ListItem, MoneyField, Sheet, Skeleton, Snackbar, StatusChip, TextField } from "@/components/ui";
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api-client";
import { copyText } from "@/lib/ui/clipboard";
import { formatBRL } from "@/lib/money";
import { isImageType } from "@/lib/ui/attachments";
import { formatDateLong } from "@/lib/ui/dates";
import { buildPlanLink, buildPlanShareText, planShareIntro } from "@/lib/ui/plan-share";
import { goalLines, goingBody, hintLine, limitHint, limitIntro, liveLimitNote, PLANNED_LABEL, plannedSupport, limitPlaceholder, ifAllLine, initialLimitCents, limitNote, myAnswerText, resultHeadline, scoreLines } from "@/lib/ui/plans";
import type { PlanPersonView, PlanView } from "@/lib/plans/view";
import { PlanText } from "./plan-text";

export type AnswerBody = { going: boolean; limitCents?: number };

/**
 * Cartão do topo. Quem responde vê só a meta (pessoas previstas e a parte) e a parte se só 80% forem; sem previsão, a parte se todos forem.
 * O placar de agora ("Fecha com N pessoas", dica, quantos responderam) é só para o criador, que precisa dele para decidir quando fechar.
 */
export function PlanResultCard({ plan }: Readonly<{ plan: PlanView }>) {
	const r = plan.result;
	const goal = goalLines(r, plan.totalCents);
	const all = ifAllLine(r);
	if (!plan.isCreator) {
		if (!goal && !all) return null;
		return (
			<Card tone="high" className="space-y-2 p-5">
				{goal ? (
					<>
						<p className="text-label-large text-on-surface-variant">Meta</p>
						<p className="money text-headline-small font-bold md:text-headline-medium">{goal.goal}</p>
						{goal.lower && <p className="text-body-large text-on-surface-variant">{goal.lower}</p>}
					</>
				) : (
					<p className="text-body-large">{all}</p>
				)}
			</Card>
		);
	}
	const hint = hintLine(r);
	const score = scoreLines(r);
	return (
		<Card tone="high" className="space-y-2 p-5" aria-live="polite">
			{goal && (
				<>
					<p className="text-label-large text-on-surface-variant">Meta</p>
					<p className="money text-title-large font-bold">{goal.goal}</p>
					{goal.lower && <p className="text-body-large text-on-surface-variant">{goal.lower}</p>}
				</>
			)}
			<p className="text-label-large text-on-surface-variant">Por enquanto</p>
			<p className="money text-headline-small font-bold md:text-headline-medium">{resultHeadline(r)}</p>
			{hint && <p className="text-body-large">{hint}</p>}
			{!goal && all && <p className="text-body-large text-on-surface-variant">{all}</p>}
			<p className="text-body-large text-on-surface-variant">
				{score.answered}
				{score.missing && <> · {score.missing}</>}
			</p>
		</Card>
	);
}

/** A resposta de uma pessoa (você ou quem você acrescentou): Vou (com limite opcional) ou Não vou. */
export function AnswerCard({
	person,
	busy,
	initialAsking = false,
	initialLimit,
	totalCents,
	goingCount,
	onAnswer,
	onRemove,
}: Readonly<{ person: PlanPersonView; busy: boolean; totalCents: number; goingCount: number; initialAsking?: boolean; initialLimit?: number; onAnswer: (body: AnswerBody) => void; onRemove?: () => void }>) {
	const [asking, setAsking] = useState(initialAsking);
	const askRef = useRef<HTMLDivElement>(null);
	const scrollOnOpen = useRef(false);
	const startLimit = initialLimit ?? initialLimitCents(person, totalCents);
	const [limit, setLimit] = useState(startLimit);
	/** Já gravado e fora da conta por enquanto: a frase calma, sem alerta. */
	const savedNote = person.answer === "going" && person.aboveLimit ? limitNote(person, person.limitCents, totalCents) : null;
	/** Ao vivo, enquanto digita: só quando o limite digitado fica abaixo da parte de hoje. */
	const liveNote = liveLimitNote(person, limit, totalCents, goingCount);
	/** Abre o campo de limite e leva o bloco todo (campo, apoio, confirmar) para a parte visível, acima da barra de baixo. */
	const openAsking = () => {
		scrollOnOpen.current = true;
		setAsking(true);
	};
	useEffect(() => {
		if (!asking || !scrollOnOpen.current) return;
		scrollOnOpen.current = false;
		const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		askRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
	}, [asking]);
	const title = person.isYou ? "Você" : person.name;
	const answered = person.answer !== "pending";
	return (
		<Card tone="low" className="space-y-3 p-4">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="break-words text-title-medium">{title}</p>
					{!person.isYou && <p className="text-body-large text-on-surface-variant">Sem celular · você responde por {person.name}</p>}
				</div>
				{onRemove && <IconButton icon="close" label={`Tirar ${person.name} do plano`} onClick={onRemove} className="-mr-2 -mt-2" />}
			</div>

			{!asking && (
				<>
					{answered ? (
						<p className="text-body-large">
							<span className="font-medium">{myAnswerText(person)}</span>
						</p>
					) : (
						<p className="text-body-large text-on-surface-variant">Você vai?</p>
					)}
					<div className="flex flex-col gap-3 sm:flex-row">
						<Button fullWidth variant={person.answer === "going" ? "tonal" : "filled"} icon="check" disabled={busy} onClick={openAsking}>
							{person.answer === "going" ? "Mudar o limite" : "Vou"}
						</Button>
						<Button fullWidth variant={person.answer === "not_going" ? "tonal" : "outlined"} disabled={busy || person.answer === "not_going"} onClick={() => onAnswer({ going: false })}>
							Não vou
						</Button>
					</div>
					{savedNote && <p className="text-body-large text-on-surface-variant">{savedNote}</p>}
				</>
			)}

			{asking && (
				<div ref={askRef} className="scroll-mb-32 space-y-3">
					{person.preview?.basis === "expected" && (
						<MoneyField id={`planejado-${person.id}`} label={PLANNED_LABEL} cents={person.preview.cents} onChange={() => {}} readOnly supportingText={plannedSupport(person.preview)} />
					)}
					<p className="text-body-large">{limitIntro(person.preview, person)}</p>
					<MoneyField
						id={`limite-${person.id}`}
						label="Até quanto posso pagar"
						cents={limit}
						onChange={setLimit}
						placeholder={limitPlaceholder(person.preview)}
						supportingText={limitHint(person.preview, totalCents)}
					/>
					{liveNote && (
						<p role="status" className="text-body-large text-on-surface">
							{liveNote}
						</p>
					)}
					<p className="text-body-large text-on-surface-variant">Só o organizador do plano e você veem esse valor.</p>
					<div className="flex flex-col gap-3 sm:flex-row">
						<Button
							fullWidth
							icon="check"
							loading={busy}
							onClick={() => {
								onAnswer(goingBody(limit));
								setAsking(false);
							}}
						>
							Confirmar que vou
						</Button>
						<Button
							fullWidth
							variant="text"
							disabled={busy}
							onClick={() => {
								setLimit(startLimit);
								setAsking(false);
							}}
						>
							Voltar
						</Button>
					</div>
				</div>
			)}
		</Card>
	);
}

function PersonRow({ person, onRemove }: Readonly<{ person: PlanPersonView; onRemove?: () => void }>) {
	const notes = [
		person.kind === "guest" ? `Sem celular · de ${person.addedByName ?? "alguém"}` : null,
		person.isCreator ? "Criou o plano" : null,
		person.answer === "going" && person.limitCents ? `Limite: ${formatBRL(person.limitCents)}` : null,
		person.aboveLimit ? "Fora da conta por enquanto" : null,
	].filter(Boolean);
	return (
		<ListItem
			leading={<Avatar name={person.name} src={person.picture} managed={person.kind === "guest"} />}
			headline={
				<>
					{person.name}
					{person.isYou && <span className="font-normal text-on-surface-variant"> (você)</span>}
				</>
			}
			supporting={notes.length ? notes.join(" · ") : undefined}
			trailing={onRemove ? <IconButton icon="close" label={`Tirar ${person.name} do plano`} onClick={onRemove} className="-mr-2" /> : undefined}
		/>
	);
}

function PeopleGroup({ title, people, onRemove }: Readonly<{ title: string; people: PlanPersonView[]; onRemove: (p: PlanPersonView) => void }>) {
	if (people.length === 0) return null;
	return (
		<section className="space-y-2" aria-label={title}>
			<h3 className="text-title-medium text-on-surface-variant">
				{title} ({people.length})
			</h3>
			<List>
				{people.map((p) => (
					<PersonRow key={p.id} person={p} onRemove={p.canRemove && !p.isYou ? () => onRemove(p) : undefined} />
				))}
			</List>
		</section>
	);
}

export type PlanDetailViewProps = {
	plan: PlanView;
	photos: AttachmentView[];
	busyWho: string | null;
	error: string | null;
	onAnswer: (who: string, body: AnswerBody) => void;
	onOpenImage: (id: string) => void;
	onShare: () => void;
	onAddGuest: () => void;
	onRemovePerson: (p: PlanPersonView) => void;
	onAskCancel: () => void;
	onAllowReturn?: (uid: string) => void;
	/** Quem está sendo liberado agora (o botão fica desabilitado enquanto a chamada roda). */
	returningUid?: string | null;
	/** Só para as telas de exemplo: abre o campo de limite de uma pessoa já preenchido. */
	mockAsking?: { who: string; limitCents?: number };
	groupHref: string | null;
	expenseHref: string | null;
};

/** Visual da tela do plano. Tudo o que muda (respostas, sheets) vem de fora. */
export function PlanDetailView(p: Readonly<PlanDetailViewProps>) {
	const { plan } = p;
	const mine = plan.people.filter((x) => x.youAnswer);
	const going = plan.people.filter((x) => x.answer === "going");
	const notGoing = plan.people.filter((x) => x.answer === "not_going");
	const pending = plan.people.filter((x) => x.answer === "pending");
	const base = `/app/planos/${encodeURIComponent(plan.id)}`;
	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<header className="space-y-1">
				<p className="flex flex-wrap gap-2 pb-1">
					{plan.status === "cancelled" && <StatusChip tone="owe">Cancelado</StatusChip>}
					{plan.status === "done" && <StatusChip tone="ok">Virou grupo e despesa</StatusChip>}
					{plan.status === "closing" && <StatusChip tone="wait">Criando o grupo...</StatusChip>}
					{plan.status === "open" && <StatusChip tone="wait">Em planejamento</StatusChip>}
				</p>
				<h1 className="break-words text-headline-medium md:text-headline-large">{plan.name}</h1>
				<p className="money text-display-small font-bold">{formatBRL(plan.totalCents)}</p>
				<p className="text-body-large text-on-surface-variant">
					Criado por {plan.creator.isYou ? "você" : plan.creator.name}
					{plan.eventDate && <> · Quando: {formatDateLong(plan.eventDate)}</>}
				</p>
				{plan.deadline && plan.open && <p className="text-body-large text-on-surface-variant">Responda até {formatDateLong(plan.deadline)}</p>}
			</header>

			{p.error && (
				<Banner tone="error" icon="error" role="alert">
					{p.error}
				</Banner>
			)}

			{plan.status === "done" && plan.closed && (
				<Banner icon="check" title={`Virou o grupo ${plan.closed.groupName}`} role="status">
					<div className="flex flex-col gap-2 pt-2 sm:flex-row">
						{p.groupHref ? (
							<Button href={p.groupHref} size="md" variant="tonal" icon="group">
								Abrir o grupo
							</Button>
						) : (
							<p>Você não está nesse grupo.</p>
						)}
						{p.expenseHref && (
							<Button href={p.expenseHref} size="md" variant="outlined" icon="receipt_long">
								Ver a despesa
							</Button>
						)}
					</div>
				</Banner>
			)}
			{plan.status === "cancelled" && (
				<Banner tone="error" icon="close" title="Este plano foi cancelado" role="status">
					Ninguém mais pode responder.
				</Banner>
			)}

			{plan.open && <PlanResultCard plan={plan} />}

			{(plan.details || p.photos.length > 0) && (
				<section className="space-y-3" aria-labelledby="detalhes-plano">
					{plan.details && (
						<>
							<h2 id="detalhes-plano" className="text-title-large">
								Detalhes
							</h2>
							<PlanText text={plan.details} />
						</>
					)}
					<ExpenseAttachments items={p.photos} onOpenImage={p.onOpenImage} onOpenPdf={p.onOpenImage} title="Fotos" />
				</section>
			)}

			{plan.open && mine.length > 0 && (
				<section className="space-y-3" aria-labelledby="sua-resposta">
					<h2 id="sua-resposta" className="text-title-large">
						{mine.length > 1 ? "Suas respostas" : "Sua resposta"}
					</h2>
					{mine.map((person) => (
						<AnswerCard
							key={`${person.id}|${person.answer}|${person.limitCents ?? 0}|${plan.totalCents}|${person.preview?.basis === "expected" ? person.preview.people : 0}`}
							person={person}
							totalCents={plan.totalCents}
							goingCount={plan.result.goingCount}
							initialAsking={p.mockAsking?.who === person.id}
							initialLimit={p.mockAsking?.who === person.id ? p.mockAsking.limitCents : undefined}
							busy={p.busyWho === person.id}
							onAnswer={(body) => p.onAnswer(person.id, body)}
							onRemove={person.kind === "guest" && person.canRemove ? () => p.onRemovePerson(person) : undefined}
						/>
					))}
				</section>
			)}
			{plan.open && plan.canAddGuest && (
				<div className="space-y-1">
					<Button variant="tonal" icon="add" onClick={p.onAddGuest} fullWidth className="md:w-auto">
						Também respondo por outra pessoa
					</Button>
					<p className="text-body-large text-on-surface-variant">Para quem vai mas não usa o app. Só o nome.</p>
				</div>
			)}

			<section className="space-y-4" aria-labelledby="quem-vai">
				<h2 id="quem-vai" className="text-title-large">
					Quem vai
				</h2>
				<PeopleGroup title="Vão" people={going} onRemove={p.onRemovePerson} />
				<PeopleGroup title="Não vão" people={notGoing} onRemove={p.onRemovePerson} />
				<PeopleGroup title="Ainda não responderam" people={pending} onRemove={p.onRemovePerson} />
			</section>

			{plan.removed.length > 0 && (
				<details className="rounded-shape-md bg-surface-container-low">
					<summary className="state-layer flex min-h-12 cursor-pointer items-center rounded-shape-md px-4 text-body-large text-on-surface-variant">
						Removidos ({plan.removed.length})
					</summary>
					<ul className="space-y-1 px-4 pb-3">
						{plan.removed.map((r) => (
							<li key={r.uid} className="flex items-center justify-between gap-2">
								<span className="min-w-0 break-words text-body-large">{r.name}</span>
								<Button variant="text" size="md" disabled={p.returningUid === r.uid} loading={p.returningUid === r.uid} onClick={() => p.onAllowReturn?.(r.uid)}>
									Permitir voltar
								</Button>
							</li>
						))}
					</ul>
					<p className="px-4 pb-3 text-body-large text-on-surface-variant">A pessoa não volta sozinha: ela precisa abrir o link do convite de novo.</p>
				</details>
			)}

			{plan.open && (
				<div className="flex flex-col gap-3">
					<Button icon="share" onClick={p.onShare} fullWidth>
						Compartilhar no WhatsApp
					</Button>
					{plan.canClose && (
						<div className="space-y-2">
							{!plan.result.fits && (
								<Banner icon="warning" role="status">
									O plano ainda não fecha. Você pode criar o grupo mesmo assim, só com quem disse que vai.
								</Banner>
							)}
							<Button href={`${base}/fechar`} variant={plan.result.fits ? "filled" : "tonal"} icon="group" fullWidth>
								Criar grupo e despesa
							</Button>
						</div>
					)}
					{plan.canEdit && (
						<Button href={`${base}/editar`} variant="outlined" icon="edit" fullWidth>
							Editar o plano
						</Button>
					)}
					{plan.canEdit && (
						<Button variant="text" size="md" icon="close" onClick={p.onAskCancel} className="-ml-4 self-start text-error!">
							Cancelar o plano
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

export function PlanDetailSkeleton() {
	return (
		<div role="status" className="mx-auto max-w-2xl space-y-6">
			<span className="sr-only">Carregando...</span>
			<Skeleton className="h-10 w-2/3" />
			<Skeleton className="h-24 rounded-shape-lg" />
			<Skeleton className="h-32 rounded-shape-lg" />
			<Skeleton className="h-[4.5rem] rounded-shape-md" />
		</div>
	);
}

type Blobs = Record<string, { url: string | null; state: "ready" | "error" }>;

export function PlanDetail({ planId }: Readonly<{ planId: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [plan, setPlan] = useState<PlanView | null>(null);
	const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [busyWho, setBusyWho] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [snack, setSnack] = useState<string | null>(() => peekFlash());
	const [blobs, setBlobs] = useState<Blobs>({});
	const [viewing, setViewing] = useState<string | null>(null);
	const urls = useRef<string[]>([]);
	// Convite e compartilhar
	const [shareText, setShareText] = useState<{ text: string; link: string } | null>(null);
	const [shareBusy, setShareBusy] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const [confirmNew, setConfirmNew] = useState(false);
	// Pessoa sem celular, tirar pessoa, cancelar
	const [guestOpen, setGuestOpen] = useState(false);
	const [guestName, setGuestName] = useState("");
	const [guestError, setGuestError] = useState<string | null>(null);
	const [guestBusy, setGuestBusy] = useState(false);
	const [removing, setRemoving] = useState<PlanPersonView | null>(null);
	const [removeBusy, setRemoveBusy] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const [cancelBusy, setCancelBusy] = useState(false);
	const [returningUid, setReturningUid] = useState<string | null>(null);

	useEffect(() => {
		clearFlash();
	}, []);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<PlanView>(`/api/plans/${encodeURIComponent(planId)}`)
			.then((d) => {
				if (!cancelled) setPlan(d);
			})
			.catch((e) => {
				if (cancelled) return;
				setError(e instanceof ApiError ? { message: e.message, notFound: e.status === 404 } : { message: "Não foi possível carregar o plano.", notFound: false });
			});
		return () => {
			cancelled = true;
		};
	}, [user, planId, reloadKey]);

	const photoUrl = (aid: string) => `/api/plans/${encodeURIComponent(planId)}/attachments/${encodeURIComponent(aid)}`;
	const photoKey = plan?.attachments.map((a) => a.id).join(",") ?? "";

	// Miniaturas: buscadas com o login e viram endereços locais (revogados ao sair da tela).
	useEffect(() => {
		if (!plan) return;
		let cancelled = false;
		for (const a of plan.attachments.filter((x) => isImageType(x.contentType))) {
			apiFetchBlob(photoUrl(a.id))
				.then((blob) => {
					const url = URL.createObjectURL(blob);
					if (cancelled) return URL.revokeObjectURL(url);
					urls.current.push(url);
					setBlobs((b) => ({ ...b, [a.id]: { url, state: "ready" } }));
				})
				.catch(() => {
					if (!cancelled) setBlobs((b) => ({ ...b, [a.id]: { url: null, state: "error" } }));
				});
		}
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [photoKey, planId]);
	useEffect(() => {
		const list = urls.current;
		return () => {
			for (const u of list) URL.revokeObjectURL(u);
		};
	}, []);

	async function call<T>(work: () => Promise<T>, onError: (m: string) => void): Promise<T | null> {
		try {
			return await work();
		} catch (e) {
			onError(e instanceof ApiError ? e.message : "Não foi possível concluir. Tente de novo.");
			return null;
		}
	}

	async function answer(who: string, body: AnswerBody) {
		setBusyWho(who);
		setActionError(null);
		const res = await call(
			() => apiFetch<PlanView>(`/api/plans/${encodeURIComponent(planId)}/responses/${encodeURIComponent(who)}`, { method: "PUT", body: JSON.stringify(body) }),
			setActionError,
		);
		setBusyWho(null);
		if (res) {
			setPlan(res);
			const person = plan?.people.find((x) => x.id === who);
			const subject = !person || person.isYou ? "você" : person.name;
			setSnack(`Resposta salva: ${subject} ${body.going ? "vai" : "não vai"}.`);
		}
	}

	async function openShare() {
		if (!plan) return;
		setShareBusy(true);
		setActionError(null);
		const res = await call(() => apiFetch<{ token: string }>(`/api/plans/${encodeURIComponent(planId)}/invite`, { method: "POST", body: JSON.stringify({}) }), setActionError);
		setShareBusy(false);
		if (res) {
			const link = buildPlanLink(window.location.origin, res.token);
			setCopyFailed(false);
			setConfirmNew(false);
			setShareText({ text: buildPlanShareText(plan, link), link });
		}
	}

	async function renewInvite() {
		if (!plan) return;
		setShareBusy(true);
		const res = await call(() => apiFetch<{ token: string }>(`/api/plans/${encodeURIComponent(planId)}/invite`, { method: "POST", body: JSON.stringify({ regenerate: true }) }), setActionError);
		setShareBusy(false);
		setConfirmNew(false);
		if (res) {
			const link = buildPlanLink(window.location.origin, res.token);
			setShareText({ text: buildPlanShareText(plan, link), link });
			setSnack("Novo link pronto. O antigo parou de funcionar.");
		}
	}

	async function addGuest() {
		setGuestBusy(true);
		setGuestError(null);
		const res = await call(() => apiFetch<PlanView>(`/api/plans/${encodeURIComponent(planId)}/guests`, { method: "POST", body: JSON.stringify({ name: guestName }) }), setGuestError);
		setGuestBusy(false);
		if (res) {
			setPlan(res);
			setGuestOpen(false);
			setGuestName("");
			setSnack("Pessoa acrescentada. Agora responda por ela.");
		}
	}

	async function removePerson() {
		if (!removing) return;
		setRemoveBusy(true);
		const person = removing;
		const path = person.kind === "guest" ? `guests/${encodeURIComponent(person.id)}` : `participants/${encodeURIComponent(person.id)}`;
		const res = await call(() => apiFetch<PlanView | { left: true }>(`/api/plans/${encodeURIComponent(planId)}/${path}`, { method: "DELETE" }), setActionError);
		setRemoveBusy(false);
		setRemoving(null);
		if (!res) return;
		if ("left" in res) {
			setFlash("Você saiu do plano.");
			router.push("/app");
			return;
		}
		setPlan(res);
		setSnack(`${person.name} saiu do plano.`);
	}

	async function allowReturn(uid: string) {
		if (returningUid) return;
		const name = plan?.removed.find((r) => r.uid === uid)?.name ?? "A pessoa";
		setReturningUid(uid);
		setActionError(null);
		try {
			const res = await apiFetch<PlanView>(`/api/plans/${encodeURIComponent(planId)}/removed/${encodeURIComponent(uid)}`, { method: "DELETE" });
			setPlan(res);
			setSnack(`${name} pode voltar pelo link do convite.`);
		} catch (e) {
			// 404: já estava liberado (ou o plano mudou). Não é erro para a pessoa: só recarrega o plano.
			if (e instanceof ApiError && e.status === 404) setReloadKey((k) => k + 1);
			else setActionError(e instanceof ApiError ? e.message : "Não foi possível concluir. Tente de novo.");
		}
		setReturningUid(null);
	}

	async function cancelPlan() {
		setCancelBusy(true);
		const res = await call(() => apiFetch<PlanView>(`/api/plans/${encodeURIComponent(planId)}`, { method: "DELETE" }), setActionError);
		setCancelBusy(false);
		setCancelOpen(false);
		if (res) {
			setPlan(res);
			setSnack("Plano cancelado.");
		}
	}

	if (error) {
		return (
			<EmptyState
				tone="error"
				icon="error"
				role="alert"
				title={error.notFound ? "Plano não encontrado" : "Ops!"}
				action={
					<>
						{!error.notFound && (
							<Button
								icon="refresh"
								onClick={() => {
									setError(null);
									setReloadKey((k) => k + 1);
								}}
							>
								Tentar de novo
							</Button>
						)}
						<Button href="/app" variant={error.notFound ? "filled" : "outlined"}>
							Voltar para o início
						</Button>
					</>
				}
			>
				{error.notFound ? "Esse plano não existe ou você não participa dele." : error.message}
			</EmptyState>
		);
	}
	if (!plan) return <PlanDetailSkeleton />;

	const photos: AttachmentView[] = plan.attachments.map((a) => ({ ...a, url: blobs[a.id]?.url ?? null, state: blobs[a.id]?.state ?? "loading" }));
	const viewed = photos.find((a) => a.id === viewing);
	const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
	const iAmCreator = plan.isCreator;

	return (
		<>
			<PlanDetailView
				plan={plan}
				photos={photos}
				busyWho={busyWho}
				error={actionError}
				onAnswer={(who, body) => void answer(who, body)}
				onOpenImage={setViewing}
				onShare={() => void openShare()}
				onAddGuest={() => {
					setGuestError(null);
					setGuestOpen(true);
				}}
				onRemovePerson={setRemoving}
				onAskCancel={() => setCancelOpen(true)}
				onAllowReturn={(uid) => void allowReturn(uid)}
				returningUid={returningUid}
				groupHref={plan.closed?.groupId ? `/app/grupos/${encodeURIComponent(plan.closed.groupId)}` : null}
				expenseHref={plan.closed?.groupId && plan.closed.expenseId ? `/app/grupos/${encodeURIComponent(plan.closed.groupId)}/despesas/${encodeURIComponent(plan.closed.expenseId)}` : null}
			/>
			{shareBusy && !shareText && <p className="sr-only" role="status">Preparando o convite...</p>}
			{!iAmCreator && plan.open && (
				<div className="mx-auto max-w-2xl pt-2">
					<Button variant="text" size="md" icon="logout" className="-ml-4 text-error!" onClick={() => setRemoving(plan.people.find((x) => x.isYou) ?? null)}>
						Sair do plano
					</Button>
				</div>
			)}

			<Sheet open={!!shareText} onClose={() => setShareText(null)} title="Compartilhar o plano">
				{shareText && (
					<div className="space-y-4">
						<ShareExpenseContent
							text={shareText.text}
							intro={planShareIntro()}
							canShare={canNativeShare}
							copyFailed={copyFailed}
							preview
							dismissLabel="Fechar"
							whatsappLabel="Enviar pelo WhatsApp"
							onCopy={() =>
								void copyText(shareText.text).then((ok) => {
									setCopyFailed(!ok);
									if (ok) setSnack("Mensagem copiada!");
								})
							}
							onShare={() => void navigator.share({ text: shareText.text }).catch(() => {})}
							onClose={() => setShareText(null)}
						/>
						{iAmCreator &&
							(confirmNew ? (
								<Banner>
									<p>O link antigo vai parar de funcionar. Continuar?</p>
									<div className="flex flex-col gap-2 pt-3">
										<Button size="md" loading={shareBusy} onClick={() => void renewInvite()}>
											Sim, gerar novo link
										</Button>
										<Button size="md" variant="text" onClick={() => setConfirmNew(false)}>
											Cancelar
										</Button>
									</div>
								</Banner>
							) : (
								<Button variant="text" size="md" icon="refresh" fullWidth onClick={() => setConfirmNew(true)}>
									Gerar novo link
								</Button>
							))}
					</div>
				)}
			</Sheet>

			<Sheet open={guestOpen} onClose={() => setGuestOpen(false)} title="Responder por outra pessoa">
				<form
					noValidate
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						void addGuest();
					}}
				>
					<p className="text-body-large text-on-surface-variant">Ela entra na divisão. Você responde por ela.</p>
					<TextField id="nome-convidado" label="Nome da pessoa" value={guestName} onChange={(e) => setGuestName(e.target.value)} error={guestError} maxLength={40} autoComplete="off" />
					<Button type="submit" fullWidth loading={guestBusy} icon="add">
						Acrescentar
					</Button>
				</form>
			</Sheet>

			<Sheet open={!!removing} onClose={() => setRemoving(null)} title={removing?.isYou ? "Sair do plano?" : `Tirar ${removing?.name ?? ""}?`}>
				<div className="space-y-4">
					<p className="text-body-large text-on-surface-variant">
						{removing?.isYou
							? "Você deixa de ver o plano e sua resposta some. Quem tem o link pode entrar de novo."
							: removing?.kind === "guest"
								? "A resposta dela some e a divisão muda."
								: "A resposta dessa pessoa some, e as pessoas sem celular que ela acrescentou saem junto."}
					</p>
					<div className="flex flex-col gap-3">
						<Button fullWidth loading={removeBusy} onClick={() => void removePerson()}>
							{removing?.isYou ? "Sair do plano" : "Tirar do plano"}
						</Button>
						<Button fullWidth variant="outlined" disabled={removeBusy} onClick={() => setRemoving(null)}>
							Voltar
						</Button>
					</div>
				</div>
			</Sheet>

			<Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar o plano?">
				<div className="space-y-4">
					<p className="text-body-large text-on-surface-variant">Quem tinha dito que vai será avisado. O plano continua visível como cancelado.</p>
					<div className="flex flex-col gap-3">
						<Button fullWidth loading={cancelBusy} onClick={() => void cancelPlan()}>
							Sim, cancelar o plano
						</Button>
						<Button fullWidth variant="outlined" disabled={cancelBusy} onClick={() => setCancelOpen(false)}>
							Voltar
						</Button>
					</div>
				</div>
			</Sheet>

			<Sheet open={!!viewed} onClose={() => setViewing(null)} title={viewed?.name ?? ""}>
				{viewed?.url && (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={viewed.url} alt={viewed.name} className="max-h-[65dvh] w-full rounded-shape-md bg-surface-container-high object-contain" />
				)}
			</Sheet>

			<Snackbar open={!!snack} message={snack ?? ""} onClose={() => setSnack(null)} />
		</>
	);
}

