"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { setFlash } from "@/components/expenses/types";
import { Avatar, Banner, Button, Card, EmptyState, FilterChip, Skeleton, SegmentedButton, TextField } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { splitEqually } from "@/lib/expenses/split";
import { MAX_NAME_LENGTH } from "@/lib/groups/helpers";
import { formatBRL } from "@/lib/money";
import { isValidISODate, todayISO } from "@/lib/ui/dates";
import { isValidDueDate } from "@/lib/ui/due-dates";
import { peopleLabel } from "@/lib/ui/invite";
import { splitPreview } from "@/lib/ui/split-preview";
import type { PlanPersonView, PlanView } from "@/lib/plans/view";

export type CloseValues = { groupName: string; selected: string[]; paidBy: string; date: string; pay: "cash" | "card"; dueDate: string };
export type CloseErrors = Partial<Record<"groupName" | "participants" | "paidBy" | "date" | "dueDate" | "form", string>>;

/** Só entra na divisão quem disse "Vou" (o servidor confere de novo). */
export const goingPeople = (plan: PlanView): PlanPersonView[] => plan.people.filter((p) => p.answer === "going");

/** Quem pode ser o pagador entre os marcados: gente que usa o app (pessoa sem celular não paga). */
export const payerChoices = (plan: PlanView, selected: string[]): PlanPersonView[] => plan.people.filter((p) => p.kind === "participant" && selected.includes(p.id));

/** O criador paga se estiver marcado; senão, o primeiro marcado que usa o app. */
export function defaultPayer(plan: PlanView, selected: string[]): string {
	const choices = payerChoices(plan, selected);
	return choices.find((p) => p.id === plan.creator.uid)?.id ?? choices[0]?.id ?? "";
}

/** O que a tela já traz marcado: quem entra na conta (ou, se não fecha, todos que disseram Vou), hoje. */
export function initialClose(plan: PlanView): CloseValues {
	const suggested = plan.result.fits ? (plan.includedIds ?? []) : (plan.goingIds ?? []);
	const selected = goingPeople(plan).filter((p) => suggested.includes(p.id)).map((p) => p.id);
	return {
		groupName: Array.from(plan.name).slice(0, MAX_NAME_LENGTH).join(""),
		selected,
		paidBy: defaultPayer(plan, selected),
		date: todayISO(),
		pay: "cash",
		dueDate: "",
	};
}

/** `payerIds`: quem pode pagar (participantes com login). */
export function validateClose(v: CloseValues, payerIds?: string[]): CloseErrors {
	const e: CloseErrors = {};
	if (!v.groupName.trim()) e.groupName = "Dê um nome ao grupo.";
	else if (v.groupName.trim().length > MAX_NAME_LENGTH) e.groupName = `Use até ${MAX_NAME_LENGTH} letras.`;
	if (v.selected.length === 0) e.participants = "Escolha pelo menos uma pessoa.";
	else if (!v.selected.includes(v.paidBy) || (payerIds && !payerIds.includes(v.paidBy))) e.paidBy = "Escolha quem pagou entre quem divide e usa o app.";
	if (!isValidISODate(v.date) || v.date > todayISO()) e.date = "Escolha uma data válida, que não seja no futuro.";
	if (v.pay === "card" && !isValidDueDate(v.dueDate, v.date, todayISO())) e.dueDate = "Escolha a data da próxima fatura.";
	return e;
}

const nameOf = (p: PlanPersonView) => (p.isYou ? "Você" : p.kind === "guest" ? `${p.name} · sem celular` : p.name);

/** Visual da tela de confirmação "Criar grupo e despesa". */
export function PlanCloseView(p: Readonly<{
	plan: PlanView;
	values: CloseValues;
	errors: CloseErrors;
	busy: boolean;
	onChange: (patch: Partial<CloseValues>) => void;
	onToggle: (id: string) => void;
	onSubmit: () => void;
}>) {
	const { plan, values: v, errors } = p;
	const chosen = payerChoices(plan, v.selected);
	const preview = splitPreview(plan.totalCents, v.selected, v.paidBy);
	// Na despesa, quem pagou fica com a sobra dos centavos: se isso passar do limite dele, avisa o criador (que vê os limites).
	const payer = plan.people.find((x) => x.id === v.paidBy);
	let payerOver: { name: string; share: number; limit: number } | null = null;
	if (payer?.limitCents && v.selected.includes(payer.id)) {
		try {
			const share = splitEqually(plan.totalCents, v.selected, payer.id).find((x) => x.uid === payer.id)?.amountCents ?? 0;
			if (share > payer.limitCents) payerOver = { name: payer.isYou ? "Você" : payer.name, share, limit: payer.limitCents };
		} catch {
			payerOver = null;
		}
	}
	const going = goingPeople(plan);
	const notGoing = plan.people.filter((x) => x.answer !== "going");
	const leftOut = going.filter((x) => !v.selected.includes(x.id));
	const guestAdders = plan.people.filter((x) => x.kind === "guest" && v.selected.includes(x.id)).map((x) => x.addedByName).filter(Boolean);
	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				p.onSubmit();
			}}
			className="mx-auto max-w-xl space-y-6 max-md:pb-2"
		>
			<header className="space-y-1">
				<h1 className="text-headline-medium">Criar grupo e despesa</h1>
				<p className="text-body-large text-on-surface-variant">
					{plan.name} · <span className="money">{formatBRL(plan.totalCents)}</span>
				</p>
			</header>

			{!plan.result.fits && (
				<Banner icon="warning" title="O plano ainda não fecha" role="status">
					Alguns limites ficam abaixo da parte de cada um. Você pode criar mesmo assim, com quem disse que vai.
				</Banner>
			)}

			<TextField id="campo-grupo" label="Nome do grupo" value={v.groupName} maxLength={MAX_NAME_LENGTH + 20} onChange={(e) => p.onChange({ groupName: e.target.value })} error={errors.groupName} autoComplete="off" />

			<fieldset id="campo-participantes" tabIndex={-1} className="space-y-3 outline-none">
				<legend className="text-title-large">Dividir entre</legend>
				<p className="text-body-large text-on-surface-variant">{v.selected.length === 0 ? "Marque quem vai dividir" : `${peopleLabel(v.selected.length)} ${v.selected.length === 1 ? "marcada" : "marcadas"}`}</p>
				<div className="flex flex-wrap gap-2">
					{going.map((x) => (
						<FilterChip
							key={x.id}
							selected={v.selected.includes(x.id)}
							onToggle={() => p.onToggle(x.id)}
							leading={<Avatar name={x.name} src={x.picture} size="sm" className="size-10" managed={x.kind === "guest"} />}
							className="max-w-full sm:max-w-xs"
						>
							{nameOf(x)}
						</FilterChip>
					))}
				</div>
				{errors.participants && (
					<p role="alert" className="text-body-large text-error">
						{errors.participants}
					</p>
				)}
				{notGoing.length > 0 && <p className="text-body-large text-on-surface-variant">Só quem disse que vai pode entrar na divisão. Ficam de fora: {notGoing.length === 1 ? "1 pessoa" : `${notGoing.length} pessoas`} que disseram não ou ainda não responderam.</p>}
				{leftOut.length > 0 && (
					<p className="text-body-large text-on-surface-variant">
						Disseram que vão, mas ficaram de fora: {leftOut.map((x) => x.name).join(", ")}. Eles serão avisados.
					</p>
				)}
			</fieldset>

			<fieldset className="space-y-3">
				<legend className="text-title-large">Quem pagou?</legend>
				<p className="text-body-large text-on-surface-variant">Só quem usa o app e vai dividir. O Pix será o dessa pessoa.</p>
				<div className="flex flex-wrap gap-2">
					{chosen.map((x) => (
						<FilterChip
							key={x.id}
							selected={v.paidBy === x.id}
							onToggle={() => p.onChange({ paidBy: x.id })}
							leading={<Avatar name={x.name} src={x.picture} size="sm" className="size-10" managed={x.kind === "guest"} />}
							className="max-w-full sm:max-w-xs"
						>
							{nameOf(x)}
						</FilterChip>
					))}
				</div>
				{errors.paidBy && (
					<p role="alert" className="text-body-large text-error">
						{errors.paidBy}
					</p>
				)}
				{chosen.length === 0 && <p className="text-body-large text-on-surface-variant">Marque pelo menos uma pessoa que usa o app para ser quem pagou.</p>}
				{payerOver && (
					<Banner icon="warning" role="status">
						{payerOver.name} ficaria com {formatBRL(payerOver.share)} (com os centavos que sobram), acima do limite de {formatBRL(payerOver.limit)}. Se preferir, escolha outra pessoa para pagar.
					</Banner>
				)}
				{v.paidBy === plan.creator.uid && <p className="text-body-large text-on-surface-variant">O Pix será o da sua conta. Se ainda não cadastrou a chave, cadastre antes no Perfil.</p>}
			</fieldset>

			{preview.kind === "ok" && (
				<Card tone="high" className="space-y-1 p-4" aria-live="polite">
					<p className="money text-title-large">{preview.line}</p>
					{preview.note && <p className="text-body-large text-on-surface-variant">{preview.note}</p>}
				</Card>
			)}
			{preview.kind === "error" && (
				<p role="alert" className="text-body-large text-error">
					{preview.message}
				</p>
			)}

			<TextField id="campo-data" type="date" floatLabel label="Data da despesa" value={v.date} max={todayISO()} onChange={(e) => p.onChange({ date: e.target.value })} error={errors.date} />
			<SegmentedButton
				label="Como foi pago"
				value={v.pay}
				options={[
					{ value: "cash", label: "À vista" },
					{ value: "card", label: "Cartão" },
				]}
				onChange={(pay) => p.onChange({ pay: pay === "card" ? "card" : "cash" })}
			/>
			{v.pay === "card" && (
				<TextField id="campo-vencimento" type="date" floatLabel label="Data da próxima fatura" value={v.dueDate} min={v.date} onChange={(e) => p.onChange({ dueDate: e.target.value })} error={errors.dueDate} />
			)}

			{guestAdders.length > 0 && (
				<p className="text-body-large text-on-surface-variant">
					As pessoas sem celular ficam sob o cuidado de quem as acrescentou ({[...new Set(guestAdders)].join(", ")}), que entra no grupo.
				</p>
			)}
			<p className="text-body-large text-on-surface-variant">Você será o administrador do grupo novo. Só quem você marcou entra.</p>

			{errors.form && (
				<Banner tone="error" icon="error" role="alert">
					{errors.form}
				</Banner>
			)}
			<Button type="submit" fullWidth loading={p.busy} icon={p.busy ? undefined : "check"}>
				{p.busy ? "Criando..." : "Criar grupo e despesa"}
			</Button>
		</form>
	);
}

export function PlanClose({ planId }: Readonly<{ planId: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [plan, setPlan] = useState<PlanView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [values, setValues] = useState<CloseValues | null>(null);
	const [errors, setErrors] = useState<CloseErrors>({});
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!user) return;
		let cancelled = false;
		apiFetch<PlanView>(`/api/plans/${encodeURIComponent(planId)}`)
			.then((d) => {
				if (cancelled) return;
				setPlan(d);
				setValues(initialClose(d));
			})
			.catch((e) => {
				if (!cancelled) setLoadError(e instanceof ApiError ? e.message : "Não foi possível carregar o plano.");
			});
		return () => {
			cancelled = true;
		};
	}, [user, planId]);

	if (loadError) {
		return (
			<EmptyState tone="error" icon="error" role="alert" title="Ops!" action={<Button href="/app">Voltar para o início</Button>}>
				{loadError}
			</EmptyState>
		);
	}
	if (!plan || !values) return <Skeleton className="mx-auto h-96 max-w-xl rounded-shape-lg" />;
	if (!plan.canClose) {
		return (
			<EmptyState tone="error" icon="error" role="alert" title="Não dá para criar agora" action={<Button href={`/app/planos/${encodeURIComponent(plan.id)}`}>Voltar para o plano</Button>}>
				Só quem criou o plano pode criar o grupo e a despesa, e só enquanto ele está aberto.
			</EmptyState>
		);
	}

	async function submit() {
		if (busy || !values || !plan) return;
		const bad = validateClose(values, payerChoices(plan, values.selected).map((x) => x.id));
		setErrors(bad);
		if (Object.keys(bad).length > 0) return;
		setBusy(true);
		try {
			const res = await apiFetch<{ groupId: string; expenseId: string }>(`/api/plans/${encodeURIComponent(plan.id)}/close`, {
				method: "POST",
				body: JSON.stringify({
					groupName: values.groupName.trim(),
					participantIds: values.selected,
					paidBy: values.paidBy,
					date: values.date,
					...(values.pay === "card" ? { dueDate: values.dueDate } : {}),
				}),
			});
			setFlash("Grupo e despesa criados!");
			router.push(`/app/grupos/${encodeURIComponent(res.groupId)}/despesas/${encodeURIComponent(res.expenseId)}`);
		} catch (err) {
			setBusy(false);
			if (err instanceof ApiError) {
				if (err.status === 409 && err.field === "pixKey") return setErrors({ form: `${err.message} O Pix fica no seu Perfil.` });
				const map: Record<string, keyof CloseErrors> = { groupName: "groupName", participantIds: "participants", paidBy: "paidBy", date: "date", dueDate: "dueDate" };
				const key = err.field ? map[err.field] : undefined;
				return setErrors(key ? { [key]: err.message } : { form: err.message });
			}
			setErrors({ form: "Não foi possível criar agora. Tente de novo." });
		}
	}

	return (
		<PlanCloseView
			plan={plan}
			values={values}
			errors={errors}
			busy={busy}
			onChange={(patch) => {
				setValues((cur) => (cur ? { ...cur, ...patch, ...(patch.pay === "cash" ? { dueDate: "" } : {}) } : cur));
				setErrors({});
			}}
			onToggle={(id) => {
				setValues((cur) => {
					if (!cur) return cur;
					const selected = cur.selected.includes(id) ? cur.selected.filter((x) => x !== id) : [...cur.selected, id];
					return { ...cur, selected, paidBy: selected.includes(cur.paidBy) ? cur.paidBy : defaultPayer(plan, selected) };
				});
				setErrors({});
			}}
			onSubmit={() => void submit()}
		/>
	);
}
